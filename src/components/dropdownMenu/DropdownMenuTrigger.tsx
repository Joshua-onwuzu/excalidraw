import clsx from "clsx";
import { useDevice, useExcalidrawAppState } from "../App";

const MenuTrigger = ({
  className = "",
  children,
  onToggle,
  isPortalCollaborator,
  onTitleInputChange,
}: {
  className?: string;
  children: React.ReactNode;
  onToggle: () => void;
  isPortalCollaborator: boolean;
  onTitleInputChange?: (e: any) => void;
}) => {
  const appState = useExcalidrawAppState();
  const device = useDevice();
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
        onClick={onToggle}
        type="button"
        data-testid="dropdown-menu-button"
      >
        {children}
      </button>
      {isPortalCollaborator && (
        <input
          onChange={onTitleInputChange}
          placeholder="Enter title ...."
          className="custom-input"
        />
      )}
    </div>
  );
};

export default MenuTrigger;
MenuTrigger.displayName = "DropdownMenuTrigger";
