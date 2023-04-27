import React from "react";
import {
  useDevice,
  useExcalidrawAppState,
  useExcalidrawSetAppState,
} from "../App";
import DropdownMenu from "../dropdownMenu/DropdownMenu";

import * as DefaultItems from "./DefaultItems";

import { UserList } from "../UserList";
import { t } from "../../i18n";
import { withInternalFallback } from "../hoc/withInternalFallback";
import { composeEventHandlers } from "../../utils";
import { useTunnels } from "../context/tunnels";
import { ISEAPair } from "gun";

const MainMenu = Object.assign(
  withInternalFallback(
    "MainMenu",
    ({
      children,
      onSelect,
      isPortalCollaborator,
      onTitleInputChange,
      onBackButtonClicked,
      authKey,
    }: {
      children?: React.ReactNode;
      /**
       * Called when any menu item is selected (clicked on).
       */
      onSelect?: (event: Event) => void;
      isPortalCollaborator?: boolean;
      onTitleInputChange?: (e: any) => void;
      onBackButtonClicked?: () => void;
      authKey?: ISEAPair;
    }) => {
      const { mainMenuTunnel } = useTunnels();
      const device = useDevice();
      const appState = useExcalidrawAppState();
      const setAppState = useExcalidrawSetAppState();
      const onClickOutside = device.isMobile
        ? undefined
        : () => setAppState({ openMenu: null });

      return (
        <mainMenuTunnel.In>
          <DropdownMenu open={appState.openMenu === "canvas"}>
            <DropdownMenu.Trigger
              onBackButtonClicked={onBackButtonClicked}
              isPortalCollaborator={isPortalCollaborator || false}
              onTitleInputChange={onTitleInputChange}
              authKey={authKey}
            >
              <svg
                width="18"
                height="29"
                viewBox="0 0 18 29"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M17.1297 3.17298L14.6498 0.707031L0.871094 14.4996L14.6637 28.2922L17.1297 25.8262L5.803 14.4996L17.1297 3.17298Z"
                  fill="black"
                />
              </svg>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content
              onClickOutside={onClickOutside}
              onSelect={composeEventHandlers(onSelect, () => {
                setAppState({ openMenu: null });
              })}
            >
              {children}
              {device.isMobile && appState.collaborators.size > 0 && (
                <fieldset className="UserList-Wrapper">
                  <legend>{t("labels.collaborators")}</legend>
                  <UserList
                    mobile={true}
                    collaborators={appState.collaborators}
                  />
                </fieldset>
              )}
            </DropdownMenu.Content>
          </DropdownMenu>
        </mainMenuTunnel.In>
      );
    },
  ),
  {
    Trigger: DropdownMenu.Trigger,
    Item: DropdownMenu.Item,
    ItemLink: DropdownMenu.ItemLink,
    ItemCustom: DropdownMenu.ItemCustom,
    Group: DropdownMenu.Group,
    Separator: DropdownMenu.Separator,
    DefaultItems,
  },
);

export default MainMenu;
