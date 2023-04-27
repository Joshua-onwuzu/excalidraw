import { ISEAPair } from "gun";
import { compressData, decompressData } from "../../data/encode";
import {
  decryptData,
  generateEncryptionKey,
  IV_LENGTH_BYTES,
} from "../../data/encryption";
import Gun from "gun";
import { serializeAsJSON } from "../../data/json";
import { restore } from "../../data/restore";
import { ImportedDataState } from "../../data/types";
import { isInvisiblySmallElement } from "../../element/sizeHelpers";
import { isInitializedImageElement } from "../../element/typeChecks";
import {
  ExcalidrawElement,
  FileId,
  NonDeletedExcalidrawElement,
} from "../../element/types";
import { t } from "../../i18n";
import { Base64 } from "base64-string";
import Sea from "gun/sea";
import {
  AppState,
  BinaryFileData,
  BinaryFiles,
  keyAlgoritms,
  KeyTypes,
  UserIdleState,
} from "../../types";
import { bytesToHexString } from "../../utils";
import {
  DELETED_ELEMENT_TIMEOUT,
  FILE_UPLOAD_MAX_BYTES,
  ROOM_ID_BYTES,
} from "../app_constants";
import { encodeFilesForUpload } from "./FileManager";
import { saveFilesToFirebase } from "./firebase";

export type SyncableExcalidrawElement = ExcalidrawElement & {
  _brand: "SyncableExcalidrawElement";
};

export const isSyncableElement = (
  element: ExcalidrawElement,
): element is SyncableExcalidrawElement => {
  if (element.isDeleted) {
    if (element.updated > Date.now() - DELETED_ELEMENT_TIMEOUT) {
      return true;
    }
    return false;
  }
  return !isInvisiblySmallElement(element);
};

export const getSyncableElements = (elements: readonly ExcalidrawElement[]) =>
  elements.filter((element) =>
    isSyncableElement(element),
  ) as SyncableExcalidrawElement[];

const BACKEND_V2_GET = process.env.REACT_APP_BACKEND_V2_GET_URL;
const BACKEND_V2_POST = process.env.REACT_APP_BACKEND_V2_POST_URL;

const generateRoomId = async () => {
  const buffer = new Uint8Array(ROOM_ID_BYTES);
  window.crypto.getRandomValues(buffer);
  return bytesToHexString(buffer);
};

/**
 * Right now the reason why we resolve connection params (url, polling...)
 * from upstream is to allow changing the params immediately when needed without
 * having to wait for clients to update the SW.
 *
 * If REACT_APP_WS_SERVER_URL env is set, we use that instead (useful for forks)
 */
export const getCollabServer = async (): Promise<{
  url: string;
  polling: boolean;
}> => {
  if (process.env.REACT_APP_WS_SERVER_URL) {
    return {
      url: process.env.REACT_APP_WS_SERVER_URL,
      polling: true,
    };
  }

  try {
    const resp = await fetch(
      `${process.env.REACT_APP_PORTAL_URL}/collab-server`,
    );
    return await resp.json();
  } catch (error) {
    console.error(error);
    throw new Error(t("errors.cannotResolveCollabServer"));
  }
};

export type EncryptedData = {
  data: ArrayBuffer;
  iv: Uint8Array;
};

export type SocketUpdateDataSource = {
  SCENE_INIT: {
    type: "SCENE_INIT";
    payload: {
      elements: readonly ExcalidrawElement[];
    };
  };
  SCENE_UPDATE: {
    type: "SCENE_UPDATE";
    payload: {
      elements: readonly ExcalidrawElement[];
    };
  };
  MOUSE_LOCATION: {
    type: "MOUSE_LOCATION";
    payload: {
      socketId: string;
      pointer: { x: number; y: number };
      button: "down" | "up";
      selectedElementIds: AppState["selectedElementIds"];
      username: string;
    };
  };
  IDLE_STATUS: {
    type: "IDLE_STATUS";
    payload: {
      socketId: string;
      userState: UserIdleState;
      username: string;
    };
  };
};

export type SocketUpdateDataIncoming =
  | SocketUpdateDataSource[keyof SocketUpdateDataSource]
  | {
      type: "INVALID_RESPONSE";
    };

export type SocketUpdateData =
  SocketUpdateDataSource[keyof SocketUpdateDataSource] & {
    _brand: "socketUpdateData";
  };

const RE_COLLAB_LINK = /^#room=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/;

export const isCollaborationLink = (link: string) => {
  const hash = new URL(link).hash;
  return RE_COLLAB_LINK.test(hash);
};

export const getLinkFormatedUrl = (link: string) => {
  const formatedLink = link.replace("/#", "");
  return formatedLink;
};

export const getRoomInfoFromLink = (link: string) => {
  const formatedLink = getLinkFormatedUrl(link);
  const url = new URL(formatedLink);

  const urlSearchParams = url.searchParams;
  const roomId = url.pathname
    .substring(url.pathname.lastIndexOf("/"))
    .replace("/", "");
  const isCollaborating = urlSearchParams.get("collab");
  const rtcKey = urlSearchParams.get("key");
  const path = url.pathname.substring(1, url.pathname.length);
  const contractAddress = path.substring(0, path.indexOf("/"));
  return { roomId, isCollaborating, rtcKey, contractAddress };
};

export const convertBase64toUint8Array = (str: string): Uint8Array => {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
};

export const convertTypedArrayToString = (data: Uint8Array) => {
  return window.btoa(
    Array.from(data)
      .map((c) => String.fromCharCode(c))
      .join(""),
  );
};

export const convertStringToTypedArray = (data: string): Uint8Array => {
  const binaryString = window.atob(data);
  const uint8 = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    uint8[i] = binaryString.charCodeAt(i);
  }
  return uint8;
};

export const importKey = (
  pemContent: string,
  format: "pkcs8" | "raw" | "spki",
  keyType: KeyTypes,
  keyUsage: KeyUsage[],
): Promise<CryptoKey> => {
  const uint8Content = convertStringToTypedArray(pemContent);
  return window.crypto.subtle.importKey(
    format,
    uint8Content.buffer,
    keyAlgoritms[keyType],
    false,
    keyUsage,
  );
};

export const importRSADecryptionKey = (
  pemContent: string,
): Promise<CryptoKey> => {
  return importKey(pemContent, "pkcs8", KeyTypes.RSA, ["decrypt"]);
};
export const importRSAEncryptionKey = (
  pemContent: string,
): Promise<CryptoKey> => {
  return importKey(pemContent, "spki", KeyTypes.RSA, ["encrypt"]);
};
export const decryptPortalRoomLockUsingRSAKey = async (
  encrypted: string,
  serverDecryptionKey?: string,
): Promise<string | undefined> => {
  if (!serverDecryptionKey) {
    return;
  }
  const decryptionKey = await importRSADecryptionKey(serverDecryptionKey); // import key from the key exported format saved as the invokers server decryption keys
  const encryptedTypedArray = convertStringToTypedArray(encrypted);

  // decrypt the data that was encrypted with server encryption key (public key)
  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: "RSA-OAEP",
    },
    decryptionKey,
    encryptedTypedArray.buffer, // data encrypted with server encrytion key
  );
  const dec = new TextDecoder();
  return dec.decode(decrypted);
};
export const encryptPortalRoomLockUsingRSAKey = async (
  value: string,
  serverEncryptionKey: string | undefined,
) => {
  if (!serverEncryptionKey) {
    return;
  }
  try {
    const encryptionKey = await importRSAEncryptionKey(serverEncryptionKey);
    const enc = new TextEncoder();
    const encoded = enc.encode(JSON.stringify(value));
    const encrypted = await window.crypto.subtle.encrypt(
      {
        name: "RSA-OAEP",
      },
      encryptionKey,
      encoded,
    );
    const uint8 = new Uint8Array(encrypted);
    const base64 = convertTypedArrayToString(uint8);
    return base64;
  } catch (error) {
    console.log(error);
    throw new Error("error");
  }
};

export const getISEAKeyPair = (
  key: string | undefined,
): ISEAPair | undefined => {
  if (!key) {
    return;
  }
  const keyInUint8Array = convertBase64toUint8Array(key);
  return JSON.parse(new TextDecoder().decode(keyInUint8Array));
};
export const resolveCollabRoomKey = (
  key: string,
): { seaKeyPair: ISEAPair; roomKey: string } => {
  const enc = new Base64();
  const b64 = enc.decode(key);
  const roomKeyMaterial = JSON.parse(b64);
  return roomKeyMaterial;
};

export const getRtcKeyFromUrl = () => {
  const { rtcKey: base64RtcKey } = getRoomInfoFromLink(window.location.href);
  if (!base64RtcKey) {
    return;
  }
  const roomKeyMaterial = resolveCollabRoomKey(base64RtcKey as string);
  return roomKeyMaterial.seaKeyPair;
};
export const getRoomKeyFromUrl = () => {
  const { rtcKey: base64RtcKey } = getRoomInfoFromLink(window.location.href);
  console.log(base64RtcKey, "base64 rtc key");
  const roomKeyMaterial = resolveCollabRoomKey(base64RtcKey as string);
  console.log(roomKeyMaterial, "roooooom material");
  return roomKeyMaterial.roomKey;
};

export const getCollaborationLinkData = (link: string) => {
  const { roomId, isCollaborating } = getRoomInfoFromLink(link);

  if (roomId && isCollaborating === "true") {
    return true;
  }
  return null;
};

export const generateCollaborationLinkData = async () => {
  const link = window.location.href;
  const { roomId } = getRoomInfoFromLink(link);
  const roomKey = await generateEncryptionKey();

  if (!roomKey || !roomId) {
    throw new Error("Couldn't generate room key");
  }

  return { roomId, roomKey };
};

export const getCollaborationLink = (data: {
  roomId: string;
  roomKey: string;
}) => {
  return `&roomKey=${data.roomKey}&collab=true`;
};

export const instantiateGun = () => {
  return Gun({
    peers: [process.env.REACT_APP_GUN_URL!],
  });
};

/**
 * Decodes shareLink data using the legacy buffer format.
 * @deprecated
 */
const legacy_decodeFromBackend = async ({
  buffer,
  decryptionKey,
}: {
  buffer: ArrayBuffer;
  decryptionKey: string;
}) => {
  let decrypted: ArrayBuffer;

  try {
    // Buffer should contain both the IV (fixed length) and encrypted data
    const iv = buffer.slice(0, IV_LENGTH_BYTES);
    const encrypted = buffer.slice(IV_LENGTH_BYTES, buffer.byteLength);
    decrypted = await decryptData(new Uint8Array(iv), encrypted, decryptionKey);
  } catch (error: any) {
    // Fixed IV (old format, backward compatibility)
    const fixedIv = new Uint8Array(IV_LENGTH_BYTES);
    decrypted = await decryptData(fixedIv, buffer, decryptionKey);
  }

  // We need to convert the decrypted array buffer to a string
  const string = new window.TextDecoder("utf-8").decode(
    new Uint8Array(decrypted),
  );
  const data: ImportedDataState = JSON.parse(string);

  return {
    elements: data.elements || null,
    appState: data.appState || null,
  };
};

const importFromBackend = async (
  id: string,
  decryptionKey: string,
): Promise<ImportedDataState> => {
  try {
    const response = await fetch(`${BACKEND_V2_GET}${id}`);

    if (!response.ok) {
      window.alert(t("alerts.importBackendFailed"));
      return {};
    }
    const buffer = await response.arrayBuffer();

    try {
      const { data: decodedBuffer } = await decompressData(
        new Uint8Array(buffer),
        {
          decryptionKey,
        },
      );
      const data: ImportedDataState = JSON.parse(
        new TextDecoder().decode(decodedBuffer),
      );

      return {
        elements: data.elements || null,
        appState: data.appState || null,
      };
    } catch (error: any) {
      console.warn(
        "error when decoding shareLink data using the new format:",
        error,
      );
      return legacy_decodeFromBackend({ buffer, decryptionKey });
    }
  } catch (error: any) {
    window.alert(t("alerts.importBackendFailed"));
    console.error(error);
    return {};
  }
};

export const loadScene = async (
  id: string | null,
  privateKey: string | null,
  // Supply local state even if importing from backend to ensure we restore
  // localStorage user settings which we do not persist on server.
  // Non-optional so we don't forget to pass it even if `undefined`.
  localDataState: ImportedDataState | undefined | null,
) => {
  let data;
  if (id != null && privateKey != null) {
    // the private key is used to decrypt the content from the server, take
    // extra care not to leak it
    data = restore(
      await importFromBackend(id, privateKey),
      localDataState?.appState,
      localDataState?.elements,
      { repairBindings: true, refreshDimensions: true },
    );
  } else {
    data = restore(localDataState || null, null, null, {
      repairBindings: true,
    });
  }

  return {
    elements: data.elements,
    appState: data.appState,
    // note: this will always be empty because we're not storing files
    // in the scene database/localStorage, and instead fetch them async
    // from a different database
    files: data.files,
    commitToHistory: false,
  };
};

export const exportToBackend = async (
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  files: BinaryFiles,
) => {
  const encryptionKey = await generateEncryptionKey("string");

  const payload = await compressData(
    new TextEncoder().encode(
      serializeAsJSON(elements, appState, files, "database"),
    ),
    { encryptionKey },
  );

  try {
    const filesMap = new Map<FileId, BinaryFileData>();
    for (const element of elements) {
      if (isInitializedImageElement(element) && files[element.fileId]) {
        filesMap.set(element.fileId, files[element.fileId]);
      }
    }

    const filesToUpload = await encodeFilesForUpload({
      files: filesMap,
      encryptionKey,
      maxBytes: FILE_UPLOAD_MAX_BYTES,
    });

    const response = await fetch(BACKEND_V2_POST, {
      method: "POST",
      body: payload.buffer,
    });
    const json = await response.json();
    if (json.id) {
      const url = new URL(window.location.href);
      // We need to store the key (and less importantly the id) as hash instead
      // of queryParam in order to never send it to the server
      url.hash = `json=${json.id},${encryptionKey}`;
      const urlString = url.toString();

      await saveFilesToFirebase({
        prefix: `/files/shareLinks/${json.id}`,
        files: filesToUpload,
      });

      window.prompt(`🔒${t("alerts.uploadedSecurly")}`, urlString);
    } else if (json.error_class === "RequestTooLargeError") {
      window.alert(t("alerts.couldNotCreateShareableLinkTooBig"));
    } else {
      window.alert(t("alerts.couldNotCreateShareableLink"));
    }
  } catch (error: any) {
    console.error(error);
    window.alert(t("alerts.couldNotCreateShareableLink"));
  }
};

export const handleChangesFromWhiteboard = async (
  draftContentNode: any,
  content: {
    elements: readonly ExcalidrawElement[];
    appState: Record<string, any>;
  },
  rtcKey: ISEAPair,
  sessionId: string,
) => {
  console.log("changes, geeeeeeeeee");
  /**
   * Only save changes from whiteboard when whiteboard is not empty
   * and when previously saved whiteboard content is not the same as the new content
   */
  // const isContentEqualsPrevContent =
  //   JSON.stringify(content) === JSON.stringify(previousWhiteboardContent);
  if (content.elements.length > 0) {
    console.log(
      "change is about to be saved with session id ==> ........",
      sessionId,
    );
    const data = {
      content,
      sessionId,
    };
    const encryptedData = await Sea.encrypt(data, rtcKey as ISEAPair);
    draftContentNode.put(encryptedData);
  }
};

export const handleUpdatesFromBoardNode = (
  draftContentNode: any,
  currentSceneElements: readonly NonDeletedExcalidrawElement[],
  callback: (content: {
    elements: readonly ExcalidrawElement[];
    appState: Record<string, any>;
  }) => void,
  rtcKey: ISEAPair,
  sessionId: string,
) => {
  /**
   * This listens for changes made on the content node
   * callback function is being called only when incoming_state was not written by the current user && user current state is not the same as the incoming_data
   */
  draftContentNode.on(async (data: string) => {
    const decryptedData = await Sea.decrypt(data, rtcKey as ISEAPair);
    console.log(decryptedData.by, "agsinbr", sessionId)

    if (
      decryptedData.by !== sessionId &&
      JSON.stringify(currentSceneElements) !==
        JSON.stringify(decryptedData.content.elements)
    ) {
      const { elements, appState } = decryptedData.content;
      callback({
        elements,
        appState: { ...appState, collaborators: [] },
      });
      draftContentNode.off();
    }
  });
};
