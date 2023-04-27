import clsx from "clsx";
import { useState } from "react";
import { useDevice, useExcalidrawAppState } from "../App";

const MenuTrigger = ({
  className = "",
  children,
  onBackButtonClicked,
  isPortalCollaborator,
  onTitleInputChange,
  draftName,
}: {
  className?: string;
  children: React.ReactNode;
  onBackButtonClicked?: () => void;
  isPortalCollaborator: boolean;
  onTitleInputChange?: (e: any) => void;
  draftName?: string;
}) => {
  const appState = useExcalidrawAppState();
  const device = useDevice();
  const [title, setTitle] = useState("");
  const classNames = clsx(
    `dropdown-menu-button ${className}`,
    "zen-mode-transition",
    {
      "transition-left": appState.zenModeEnabled,
      "dropdown-menu-button--mobile": device.isMobile,
    },
  ).trim();
  return (
    <div className="custom-tool">
      <button
        data-prevent-outside-click
        className={classNames}
        onClick={onBackButtonClicked}
        type="button"
        data-testid="dropdown-menu-button"
      >
        {children}
      </button>
      {isPortalCollaborator && (
        <input
          value={draftName || title}
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
