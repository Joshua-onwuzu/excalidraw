import polyfill from "../polyfill";
import LanguageDetector from "i18next-browser-languagedetector";
import { useEffect, useRef, useState } from "react";
import { trackEvent } from "../analytics";
import { getDefaultAppState } from "../appState";
import { ErrorDialog } from "../components/ErrorDialog";
import { TopErrorBoundary } from "../components/TopErrorBoundary";
import {
  APP_NAME,
  EVENT,
  THEME,
  TITLE_TIMEOUT,
  VERSION_TIMEOUT,
} from "../constants";
import { loadFromBlob } from "../data/blob";
import {
  ExcalidrawElement,
  FileId,
  NonDeletedExcalidrawElement,
  Theme,
} from "../element/types";
import { useCallbackRefState } from "../hooks/useCallbackRefState";
import { t } from "../i18n";
import {
  Excalidraw,
  defaultLang,
  LiveCollaborationTrigger,
} from "../packages/excalidraw/index";
import {
  AppState,
  LibraryItems,
  ExcalidrawImperativeAPI,
  BinaryFiles,
  ExcalidrawInitialDataState,
  IDraftMetadata,
} from "../types";
import {
  debounce,
  getVersion,
  getFrame,
  isTestEnv,
  preventUnload,
  ResolvablePromise,
  resolvablePromise,
} from "../utils";
import {
  FIREBASE_STORAGE_PREFIXES,
  STORAGE_KEYS,
  SYNC_BROWSER_TABS_TIMEOUT,
} from "./app_constants";
import Collab, {
  CollabAPI,
  collabAPIAtom,
  collabDialogShownAtom,
  isCollaboratingAtom,
  isOfflineAtom,
} from "./collab/Collab";
import {
  exportToBackend,
  getCollaborationLinkData,
  getRoomInfoFromLink,
  getRtcKeyFromUrl,
  handleChangesFromWhiteboard,
  handleUpdatesFromBoardNode,
  instantiateGun,
  isCollaborationLink,
  loadScene,
} from "./data";
import {
  getLibraryItemsFromStorage,
  importFromLocalStorage,
  importUsernameFromLocalStorage,
} from "./data/localStorage";
import CustomStats from "./CustomStats";
import { restore, restoreAppState, RestoredDataState } from "../data/restore";
import { ExportToExcalidrawPlus } from "./components/ExportToExcalidrawPlus";
import { updateStaleImageStatuses } from "./data/FileManager";
import { newElementWith } from "../element/mutateElement";
import { isInitializedImageElement } from "../element/typeChecks";
import { loadFilesFromFirebase } from "./data/firebase";
import { LocalData } from "./data/LocalData";
import { isBrowserStorageStateNewer } from "./data/tabSync";
import clsx from "clsx";
import { reconcileElements } from "./collab/reconciliation";
import { parseLibraryTokensFromUrl, useHandleLibrary } from "../data/library";
import { AppMainMenu } from "./components/AppMainMenu";
import { AppWelcomeScreen } from "./components/AppWelcomeScreen";
import { AppFooter } from "./components/AppFooter";
import { atom, Provider, useAtom, useAtomValue } from "jotai";
import { useAtomWithInitialValue } from "../jotai";
import { appJotaiStore } from "./app-jotai";

import "./index.scss";
import { ResolutionType } from "../utility-types";
import { ISEAPair } from "gun";
import uuid from "react-uuid";

polyfill();

window.EXCALIDRAW_THROTTLE_RENDER = true;

const sessionId = uuid();

const languageDetector = new LanguageDetector();
languageDetector.init({
  languageUtils: {},
});

const initializeScene = async (opts: {
  collabAPI: CollabAPI;
  excalidrawAPI: ExcalidrawImperativeAPI;
  authKey?: ISEAPair;
}) => {
  if (!opts.collabAPI || !opts.excalidrawAPI) {
    return;
  }
  const isCollaborating = getCollaborationLinkData(window.location.href);
  if (isCollaborating) {
    await opts.collabAPI.startCollaboration(isCollaborating);

    // return {
    //   // when collaborating, the state may have already been updated at this
    //   // point (we may have received updates from other clients), so reconcile
    //   // elements and appState with existing state
    //   scene: {
    //     ...scene,
    //     appState: {
    //       ...restoreAppState(
    //         {
    //           ...scene?.appState,
    //           theme: scene?.appState?.theme,
    //         },
    //         excalidrawAPI.getAppState(),
    //       ),
    //       // necessary if we're invoking from a hashchange handler which doesn't
    //       // go through App.initializeScene() that resets this flag
    //       isLoading: false,
    //     },
    //     elements: reconcileElements(
    //       scene?.elements || [],
    //       excalidrawAPI.getSceneElementsIncludingDeleted(),
    //       excalidrawAPI.getAppState(),
    //     ),
    //   },
    //   isExternalScene: true,
    //   id: roomLinkData.roomId,
    //   key: roomLinkData.roomKey,
    // };
  }
  // else if (scene) {
  //   return isExternalScene && jsonBackendMatch
  //     ? {
  //         scene,
  //         isExternalScene,
  //         id: jsonBackendMatch[1],
  //         key: jsonBackendMatch[2],
  //       }
  //     : { scene, isExternalScene: false };
  // }
  // return { scene: null, isExternalScene: false };
};

const detectedLangCode = languageDetector.detect() || defaultLang.code;
export const appLangCodeAtom = atom(
  Array.isArray(detectedLangCode) ? detectedLangCode[0] : detectedLangCode,
);

const ExcalidrawWrapper = ({
  isPortalCollaborator,
  handlePublish,
  onTitleInputChange,
  onBackButtonClicked,
  authKey,
  handleDownload,
}: {
  isPortalCollaborator?: boolean;
  handlePublish?: (excalidrawAPI: ExcalidrawImperativeAPI | null) => void;
  onTitleInputChange?: (e: any) => void;
  onBackButtonClicked?: () => void;
  authKey?: ISEAPair;
  handleDownload?: (api: ExcalidrawImperativeAPI | null) => void;
}) => {
  const [errorMessage, setErrorMessage] = useState("");
  const [langCode, setLangCode] = useAtom(appLangCodeAtom);

  const rtcKey = getRtcKeyFromUrl();
  const { roomId } = getRoomInfoFromLink(window.location.href);
  const whiteboardNode = instantiateGun()
    .user()
    .auth(rtcKey as ISEAPair)
    .get(`content/${roomId}`);

  // initial state
  // ---------------------------------------------------------------------------

  // const initialStatePromiseRef = useRef<{
  //   promise: ResolvablePromise<ExcalidrawInitialDataState | null>;
  // }>({ promise: null! });
  // if (!initialStatePromiseRef.current.promise) {
  //   initialStatePromiseRef.current.promise =
  //     resolvablePromise<ExcalidrawInitialDataState | null>();
  // }

  useEffect(() => {
    trackEvent("load", "frame", getFrame());
    // Delayed so that the app has a time to load the latest SW
    setTimeout(() => {
      trackEvent("load", "version", getVersion());
    }, VERSION_TIMEOUT);
  }, []);

  const [excalidrawAPI, excalidrawRefCallback] =
    useCallbackRefState<ExcalidrawImperativeAPI>();

  const [collabAPI] = useAtom(collabAPIAtom);
  const [, setCollabDialogShown] = useAtom(collabDialogShownAtom);
  const [isCollaborating] = useAtomWithInitialValue(isCollaboratingAtom, () => {
    return isCollaborationLink(window.location.href);
  });

  useHandleLibrary({
    excalidrawAPI,
    getInitialLibraryItems: getLibraryItemsFromStorage,
  });

  useEffect(() => {
    if (!collabAPI || !excalidrawAPI) {
      return;
    }

    // const loadImages = (
    //   data: ResolutionType<typeof initializeScene>,
    //   isInitialLoad = false,
    // ) => {
    //   if (!data.scene) {
    //     return;
    //   }
    //   if (collabAPI.isCollaborating()) {
    //     if (data.scene.elements) {
    //       collabAPI
    //         .fetchImageFilesFromFirebase({
    //           elements: data.scene.elements,
    //           forceFetchFiles: true,
    //         })
    //         .then(({ loadedFiles, erroredFiles }) => {
    //           excalidrawAPI.addFiles(loadedFiles);
    //           updateStaleImageStatuses({
    //             excalidrawAPI,
    //             erroredFiles,
    //             elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
    //           });
    //         });
    //     }
    //   } else {
    //     const fileIds =
    //       data.scene.elements?.reduce((acc, element) => {
    //         if (isInitializedImageElement(element)) {
    //           return acc.concat(element.fileId);
    //         }
    //         return acc;
    //       }, [] as FileId[]) || [];

    //     if (data.isExternalScene) {
    //       loadFilesFromFirebase(
    //         `${FIREBASE_STORAGE_PREFIXES.shareLinkFiles}/${data.id}`,
    //         data.key,
    //         fileIds,
    //       ).then(({ loadedFiles, erroredFiles }) => {
    //         excalidrawAPI.addFiles(loadedFiles);
    //         updateStaleImageStatuses({
    //           excalidrawAPI,
    //           erroredFiles,
    //           elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
    //         });
    //       });
    //     } else if (isInitialLoad) {
    //       if (fileIds.length) {
    //         LocalData.fileStorage
    //           .getFiles(fileIds)
    //           .then(({ loadedFiles, erroredFiles }) => {
    //             if (loadedFiles.length) {
    //               excalidrawAPI.addFiles(loadedFiles);
    //             }
    //             updateStaleImageStatuses({
    //               excalidrawAPI,
    //               erroredFiles,
    //               elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
    //             });
    //           });
    //       }
    //       // on fresh load, clear unused files from IDB (from previous
    //       // session)
    //       LocalData.fileStorage.clearObsoleteFiles({ currentFileIds: fileIds });
    //     }
    //   }
    // };

    initializeScene({ collabAPI, excalidrawAPI });

    const onHashChange = async (event: HashChangeEvent) => {
      event.preventDefault();
      const libraryUrlTokens = parseLibraryTokensFromUrl();
      if (!libraryUrlTokens) {
        if (
          collabAPI.isCollaborating() &&
          !isCollaborationLink(window.location.href)
        ) {
          collabAPI.stopCollaboration(false);
        }
        excalidrawAPI.updateScene({ appState: { isLoading: true } });

        // initializeScene({ collabAPI, excalidrawAPI }).then((data) => {
        //   loadImages(data);
        //   if (data.scene) {
        //     excalidrawAPI.updateScene({
        //       ...data.scene,
        //       ...restore(data.scene, null, null, { repairBindings: true }),
        //       commitToHistory: true,
        //     });
        //   }
        // });
      }
    };

    const titleTimeout = setTimeout(
      () => (document.title = APP_NAME),
      TITLE_TIMEOUT,
    );

    const syncData = debounce(() => {
      if (isTestEnv()) {
        return;
      }
      if (!document.hidden && !collabAPI.isCollaborating()) {
        // don't sync if local state is newer or identical to browser state
        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_DATA_STATE)) {
          const localDataState = importFromLocalStorage();
          const username = importUsernameFromLocalStorage();
          let langCode = languageDetector.detect() || defaultLang.code;
          if (Array.isArray(langCode)) {
            langCode = langCode[0];
          }
          setLangCode(langCode);
          excalidrawAPI.updateScene({
            ...localDataState,
          });
          excalidrawAPI.updateLibrary({
            libraryItems: getLibraryItemsFromStorage(),
          });
          collabAPI.setUsername(username || "");
        }

        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_FILES)) {
          const elements = excalidrawAPI.getSceneElementsIncludingDeleted();
          const currFiles = excalidrawAPI.getFiles();
          const fileIds =
            elements?.reduce((acc, element) => {
              if (
                isInitializedImageElement(element) &&
                // only load and update images that aren't already loaded
                !currFiles[element.fileId]
              ) {
                return acc.concat(element.fileId);
              }
              return acc;
            }, [] as FileId[]) || [];
          if (fileIds.length) {
            LocalData.fileStorage
              .getFiles(fileIds)
              .then(({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
        }
      }
    }, SYNC_BROWSER_TABS_TIMEOUT);

    const onUnload = () => {
      LocalData.flushSave();
    };

    const visibilityChange = (event: FocusEvent | Event) => {
      if (event.type === EVENT.BLUR || document.hidden) {
        LocalData.flushSave();
      }
      if (
        event.type === EVENT.VISIBILITY_CHANGE ||
        event.type === EVENT.FOCUS
      ) {
        syncData();
      }
    };

    window.addEventListener(EVENT.HASHCHANGE, onHashChange, false);
    window.addEventListener(EVENT.UNLOAD, onUnload, false);
    window.addEventListener(EVENT.BLUR, visibilityChange, false);
    document.addEventListener(EVENT.VISIBILITY_CHANGE, visibilityChange, false);
    window.addEventListener(EVENT.FOCUS, visibilityChange, false);
    return () => {
      window.removeEventListener(EVENT.HASHCHANGE, onHashChange, false);
      window.removeEventListener(EVENT.UNLOAD, onUnload, false);
      window.removeEventListener(EVENT.BLUR, visibilityChange, false);
      window.removeEventListener(EVENT.FOCUS, visibilityChange, false);
      document.removeEventListener(
        EVENT.VISIBILITY_CHANGE,
        visibilityChange,
        false,
      );
      clearTimeout(titleTimeout);
    };
  }, [collabAPI, excalidrawAPI, setLangCode]);

  useEffect(() => {
    const unloadHandler = (event: BeforeUnloadEvent) => {
      LocalData.flushSave();

      if (
        excalidrawAPI &&
        LocalData.fileStorage.shouldPreventUnload(
          excalidrawAPI.getSceneElements(),
        )
      ) {
        preventUnload(event);
      }
    };
    const currentSceneElements = excalidrawAPI?.getSceneElements();
    console.log(excalidrawAPI?.getAppState(), "Appstate");
    const callback = ({
      elements,
      appState,
    }: {
      elements: readonly ExcalidrawElement[];
      appState: any;
    }) => {
      console.log({ elements, appState }, "damn");
      excalidrawAPI?.updateScene({
        elements,
        appState,
      });
      console.log("it should have updated scene ");
    };
    if (excalidrawAPI) {
      console.log("saving to whiteboard with rtc key:", rtcKey);
      handleUpdatesFromBoardNode(
        whiteboardNode,
        currentSceneElements as NonDeletedExcalidrawElement[],
        callback,
        rtcKey as ISEAPair,
        sessionId,
      );
    }

    window.addEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    return () => {
      window.removeEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    };
  }, [excalidrawAPI]);

  useEffect(() => {
    languageDetector.cacheUserLanguage(langCode);
  }, [langCode]);

  const [theme, setTheme] = useState<Theme>(
    () =>
      localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_THEME) ||
      // FIXME migration from old LS scheme. Can be removed later. #5660
      importFromLocalStorage().appState?.theme ||
      THEME.LIGHT,
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.LOCAL_STORAGE_THEME, theme);
    // currently only used for body styling during init (see public/index.html),
    // but may change in the future
    document.documentElement.classList.toggle("dark", theme === THEME.DARK);
  }, [theme]);

  const onChange = async (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    if (collabAPI?.isCollaborating()) {
      collabAPI.syncElements(elements);
    }

    setTheme(appState.theme);

    console.log("hitting on change with sessionId", sessionId);

    await handleChangesFromWhiteboard(
      whiteboardNode,
      { elements, appState },
      rtcKey as ISEAPair,
      sessionId,
    );
    console.log("hitting benji");
    // setPrevWhiteboardContent({ elements, appState });

    // this check is redundant, but since this is a hot path, it's best
    // not to evaludate the nested expression every time
    // if (!LocalData.isSavePaused()) {
    //   LocalData.save(elements, appState, files, () => {
    //     if (excalidrawAPI) {
    //       let didChange = false;

    //       const elements = excalidrawAPI
    //         .getSceneElementsIncludingDeleted()
    //         .map((element) => {
    //           if (
    //             LocalData.fileStorage.shouldUpdateImageElementStatus(element)
    //           ) {
    //             const newElement = newElementWith(element, { status: "saved" });
    //             if (newElement !== element) {
    //               didChange = true;
    //             }
    //             return newElement;
    //           }
    //           return element;
    //         });

    //       if (didChange) {
    //         excalidrawAPI.updateScene({
    //           elements,
    //         });
    //       }
    //     }
    //   });
    // }
  };

  const onExportToBackend = async (
    exportedElements: readonly NonDeletedExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
    canvas: HTMLCanvasElement | null,
  ) => {
    if (exportedElements.length === 0) {
      return window.alert(t("alerts.cannotExportEmptyCanvas"));
    }
    if (canvas) {
      try {
        await exportToBackend(
          exportedElements,
          {
            ...appState,
            viewBackgroundColor: appState.exportBackground
              ? appState.viewBackgroundColor
              : getDefaultAppState().viewBackgroundColor,
          },
          files,
        );
      } catch (error: any) {
        if (error.name !== "AbortError") {
          const { width, height } = canvas;
          console.error(error, { width, height });
          setErrorMessage(error.message);
        }
      }
    }
  };

  const renderCustomStats = (
    elements: readonly NonDeletedExcalidrawElement[],
    appState: AppState,
  ) => {
    return (
      <CustomStats
        setToast={(message) => excalidrawAPI!.setToast({ message })}
        appState={appState}
        elements={elements}
      />
    );
  };

  const onLibraryChange = async (items: LibraryItems) => {
    if (!items.length) {
      localStorage.removeItem(STORAGE_KEYS.LOCAL_STORAGE_LIBRARY);
      return;
    }
    const serializedItems = JSON.stringify(items);
    localStorage.setItem(STORAGE_KEYS.LOCAL_STORAGE_LIBRARY, serializedItems);
  };

  const isOffline = useAtomValue(isOfflineAtom);

  return (
    <div
      style={{ height: "100%" }}
      className={clsx("excalidraw-app", {
        "is-collaborating": isCollaborating,
      })}
    >
      <Excalidraw
        ref={excalidrawRefCallback}
        onChange={onChange}
        isCollaborating={isCollaborating}
        onPointerUpdate={collabAPI?.onPointerUpdate}
        UIOptions={{
          canvasActions: {
            toggleTheme: true,
            export: {
              onExportToBackend,
              renderCustomUI: (elements, appState, files) => {
                return (
                  <ExportToExcalidrawPlus
                    elements={elements}
                    appState={appState}
                    files={files}
                    onError={(error) => {
                      excalidrawAPI?.updateScene({
                        appState: {
                          errorMessage: error.message,
                        },
                      });
                    }}
                  />
                );
              },
            },
          },
        }}
        langCode={langCode}
        renderCustomStats={renderCustomStats}
        detectScroll={false}
        handleKeyboardGlobally={true}
        onLibraryChange={onLibraryChange}
        autoFocus={true}
        theme={theme}
        renderTopRightUI={(isMobile) => {
          if (isMobile) {
            return null;
          }
          return (
            <div className="custom-tool">
              <LiveCollaborationTrigger
                isCollaborating={isCollaborating}
                onSelect={() => setCollabDialogShown(true)}
              />
              <div
                onClick={() => {
                  !!handleDownload && handleDownload(excalidrawAPI);
                }}
                className="library-button"
              >
                <svg
                  version="1.1"
                  id="Layer_1"
                  xmlns="http://www.w3.org/2000/svg"
                  x="0px"
                  y="0px"
                  viewBox="0 0 330 330"
                >
                  <g id="XMLID_23_">
                    <path
                      id="XMLID_24_"
                      d="M154.389,255.602c0.351,0.351,0.719,0.683,1.103,0.998c0.169,0.138,0.347,0.258,0.52,0.388
		c0.218,0.164,0.432,0.333,0.659,0.484c0.212,0.142,0.432,0.265,0.649,0.395c0.202,0.121,0.4,0.248,0.608,0.359
		c0.223,0.12,0.453,0.221,0.681,0.328c0.215,0.102,0.427,0.21,0.648,0.301c0.223,0.092,0.45,0.167,0.676,0.247
		c0.236,0.085,0.468,0.175,0.709,0.248c0.226,0.068,0.456,0.119,0.684,0.176c0.246,0.062,0.489,0.131,0.739,0.181
		c0.263,0.052,0.529,0.083,0.794,0.121c0.219,0.031,0.435,0.073,0.658,0.095c0.492,0.048,0.986,0.075,1.48,0.075
		c0.494,0,0.988-0.026,1.479-0.075c0.226-0.022,0.444-0.064,0.667-0.096c0.262-0.037,0.524-0.068,0.784-0.12
		c0.255-0.05,0.504-0.121,0.754-0.184c0.223-0.057,0.448-0.105,0.669-0.172c0.246-0.075,0.483-0.167,0.724-0.253
		c0.221-0.08,0.444-0.152,0.662-0.242c0.225-0.093,0.44-0.202,0.659-0.306c0.225-0.106,0.452-0.206,0.672-0.324
		c0.21-0.112,0.408-0.239,0.611-0.361c0.217-0.13,0.437-0.252,0.648-0.394c0.222-0.148,0.431-0.314,0.644-0.473
		c0.179-0.134,0.362-0.258,0.536-0.4c0.365-0.3,0.714-0.617,1.049-0.949c0.016-0.016,0.034-0.028,0.049-0.044l70.002-69.998
		c5.858-5.858,5.858-15.355,0-21.213c-5.857-5.857-15.355-5.858-21.213-0.001l-44.396,44.393V25c0-8.284-6.716-15-15-15
		c-8.284,0-15,6.716-15,15v183.785l-44.392-44.391c-5.857-5.858-15.355-5.858-21.213,0c-5.858,5.858-5.858,15.355,0,21.213
		L154.389,255.602z"
                    />
                    <path
                      id="XMLID_25_"
                      d="M315,160c-8.284,0-15,6.716-15,15v115H30V175c0-8.284-6.716-15-15-15c-8.284,0-15,6.716-15,15v130
		c0,8.284,6.716,15,15,15h300c8.284,0,15-6.716,15-15V175C330,166.716,323.284,160,315,160z"
                    />
                  </g>
                </svg>
              </div>
              {isPortalCollaborator && (
                <div
                  onClick={() => {
                    if (isPortalCollaborator && !!handlePublish) {
                      collabAPI?.stopCollaboration();
                      handlePublish(excalidrawAPI);
                    }
                  }}
                  className="library-button"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="18"
                    viewBox="0 0 14 18"
                    fill="none"
                  >
                    <path
                      d="M4 13.5H10V7.5H14L7 0.5L0 7.5H4V13.5ZM7 3.33L9.17 5.5H8V11.5H6V5.5H4.83L7 3.33ZM0 15.5H14V17.5H0V15.5Z"
                      fill="#000000"
                    />
                  </svg>
                  <p>Publish</p>
                </div>
              )}
            </div>
          );
        }}
      >
        <AppMainMenu
          setCollabDialogShown={setCollabDialogShown}
          isCollaborating={isCollaborating}
          onTitleInputChange={onTitleInputChange}
          isPortalCollaborator={isPortalCollaborator}
          onBackButtonClicked={onBackButtonClicked}
          authKey={authKey}
        />
        {/* <AppWelcomeScreen setCollabDialogShown={setCollabDialogShown} /> */}
        <AppFooter />
        {isCollaborating && isOffline && (
          <div className="collab-offline-warning">
            {t("alerts.collabOfflineWarning")}
          </div>
        )}
      </Excalidraw>
      {excalidrawAPI && <Collab excalidrawAPI={excalidrawAPI} />}
      {errorMessage && (
        <ErrorDialog onClose={() => setErrorMessage("")}>
          {errorMessage}
        </ErrorDialog>
      )}
    </div>
  );
};

const ExcalidrawApp = ({
  isCollaborator,
  handlePublish,
  onTitleInputChange,
  onBackButtonClicked,
  authKey,
  handleDownload,
}: {
  isCollaborator?: boolean;
  handlePublish?: (excalidrawAPI: ExcalidrawImperativeAPI | null) => void;
  onTitleInputChange?: (e: any) => void;
  onBackButtonClicked?: () => void;
  authKey?: ISEAPair;
  handleDownload?: (api: ExcalidrawImperativeAPI | null) => void;
}) => {
  return (
    <TopErrorBoundary>
      <Provider unstable_createStore={() => appJotaiStore}>
        <ExcalidrawWrapper
          handlePublish={handlePublish}
          isPortalCollaborator={isCollaborator}
          onTitleInputChange={onTitleInputChange}
          onBackButtonClicked={onBackButtonClicked}
          authKey={authKey}
          handleDownload={handleDownload}
        />
      </Provider>
    </TopErrorBoundary>
  );
};

export default ExcalidrawApp;
