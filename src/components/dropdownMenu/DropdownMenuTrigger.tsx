import clsx from "clsx";
import { ISEAPair } from "gun";
import { useAtom } from "jotai";
import { useEffect, useState } from "react";
import { collabAPIAtom } from "../../excalidraw-app/collab/Collab";
import { getRoomInfoFromLink, instantiateGun } from "../../excalidraw-app/data";
import { IDraftMetadata } from "../../types";
import { useDevice, useExcalidrawAppState } from "../App";

const idTracker: any[] = [];

const MenuTrigger = ({
  className = "",
  children,
  onBackButtonClicked,
  isPortalCollaborator,
  onTitleInputChange,
  authKey,
}: {
  className?: string;
  children: React.ReactNode;
  onBackButtonClicked?: () => void;
  isPortalCollaborator: boolean;
  onTitleInputChange?: (e: any) => void;
  authKey?: ISEAPair;
}) => {
  const appState = useExcalidrawAppState();
  const device = useDevice();
  const [title, setTitle] = useState("");
  const [collabAPI] = useAtom(collabAPIAtom);
  const classNames = clsx(
    `dropdown-menu-button ${className}`,
    "zen-mode-transition",
    {
      "transition-left": appState.zenModeEnabled,
      "dropdown-menu-button--mobile": device.isMobile,
    },
  ).trim();
  useEffect(() => {
    if (authKey && isPortalCollaborator) {
      const { contractAddress, roomId } = getRoomInfoFromLink(
        window.location.href,
      );
      const gun = instantiateGun();
      const portalDraftMetaDataNode = gun
        .user()
        .auth(authKey as ISEAPair)
        .get(`${contractAddress}/rtc`)
        .get(roomId);
      portalDraftMetaDataNode.on((data: IDraftMetadata, id: any) => {
        if (!idTracker.includes(id)) {
          idTracker.push(id);
          setTitle(data.name);
          portalDraftMetaDataNode.off();
        }
      });
    }
  }, []);

  return (
    <div className="custom-tool">
      <button
        data-prevent-outside-click
        className={classNames}
        onClick={(e) => {
          collabAPI?.stopCollaboration();
          onBackButtonClicked && onBackButtonClicked();
        }}
        type="button"
        data-testid="dropdown-menu-button"
      >
        {children}
      </button>
      {isPortalCollaborator && (
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            !!onTitleInputChange && onTitleInputChange(e);
          }}
          placeholder="Enter title ...."
          className="custom-input"
        />
      )}
    </div>
  );
};

export default MenuTrigger;
MenuTrigger.displayName = "DropdownMenuTrigger";
