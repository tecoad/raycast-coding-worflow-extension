/**
 * Raycast extension for managing coding sessions
 *
 * Features:
 * - Tree navigation through project folders (ignores .dot folders)
 * - Recursively detects projects with package.json files
 * - Extracts port numbers from package.json scripts
 * - Shows project type with minimal icons (only folders get icons)
 * - Handles leaf folders (folders with no package.json and no valid subfolders)
 * - Automates development workflow (opens in Cursor, runs dev server, optionally opens browser)
 * - Conditional Chrome opening based on port detection
 * - Recent folders tracking with search boost keywords
 * - Manual window arrangement (you control window positioning)
 * - Automatically closes Cursor's secondary sidebar (Explorer panel) on open
 * - DRY code architecture with reusable script generators
 *
 * Navigation Logic:
 * - Folders with package.json → Show development workflow
 * - Folders with valid subfolders (non-dot) → Navigate deeper
 * - Folders with neither → Treat as leaf folder (open directly in Cursor)
 *
 * Icon System:
 * - 📁 Folder icon: Only for navigable folders
 * - No icon: Projects and leaf folders (clean, minimal)
 * - ⭐ Star accessory: Recently opened folders (< 1 hour)
 *
 * Recent Folders Boost:
 * - ⭐ Star icon: Opened within last hour (highest priority)
 * - 🔥 "hot": Search keyword for last hour
 * - "recent": Opened within last day
 * - "opened": Opened within last 3 days
 * - Search results prioritize recently used folders
 */

import { Action, ActionPanel, getPreferenceValues, Icon, List, LocalStorage, showToast, Toast, useNavigation } from "@raycast/api";
import { execSync } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { useEffect, useState } from "react";

interface Project {
  name: string;
  path: string;
  packageJsonPath: string | null; // Path to the actual package.json file (may be in parent directory)
  hasPackageJson: boolean;
  hasBunLock: boolean;
  port: string | null; // Detected port from package.json scripts
  hasValidSubfolders: boolean; // Whether folder has non-dot subfolders
  isLeafFolder: boolean; // Whether this is a leaf folder (no package.json and no valid subfolders)
}

interface Preferences {
  devFolderPath: string; // Path to the development projects folder
  defaultPort: string; // Default port for development server
}

/**
 * Finds the nearest package.json file by walking up the directory tree
 * @param startPath - Starting directory path to search from
 * @returns Path to package.json or null if not found
 */
const findPackageJson = (startPath: string): string | null => {
  let currentPath = startPath;
  const rootPath = join(startPath, '..', '..', '..'); // Prevent infinite loops by setting a reasonable root

  while (currentPath !== rootPath) {
    const packageJsonPath = join(currentPath, 'package.json');
    if (existsSync(packageJsonPath)) {
      return packageJsonPath;
    }
    currentPath = dirname(currentPath);
  }

  return null;
};

/**
 * Extracts port number from package.json scripts
 * @param packageJsonPath - Path to package.json file
 * @returns Port number as string or null if not found
 */
const extractPortFromPackageJson = (packageJsonPath: string): string | null => {
  try {
    const packageJsonContent = readFileSync(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonContent);

    const scripts = packageJson.scripts || {};

    // Common dev script patterns that include port numbers
    const portPatterns = [
      /--port\s+(\d+)/,
      /-p\s+(\d+)/,
      /PORT=(\d+)/,
      /port\s*=\s*(\d+)/,
      /localhost:(\d+)/,
      /127\.0\.0\.1:(\d+)/,
      /0\.0\.0\.0:(\d+)/
    ];

    for (const [scriptName, scriptCommand] of Object.entries(scripts)) {
      if (typeof scriptCommand === 'string') {
        for (const pattern of portPatterns) {
          const match = scriptCommand.match(pattern);
          if (match && match[1]) {
            return match[1];
          }
        }
      }
    }

    return null;
  } catch (error) {
    console.error(`Error reading package.json at ${packageJsonPath}:`, error);
    return null;
  }
};

/**
 * Execute AppleScript by writing it to a temporary file and running it with osascript
 * This approach provides better system integration for application focus management
 */
const executeAppleScript = (script: string): void => {
  const tempScriptPath = join(tmpdir(), `raycast-workflow-${Date.now()}.scpt`);

  try {
    // Write the AppleScript to a temporary file
    writeFileSync(tempScriptPath, script, "utf8");

    // Execute using osascript for proper system integration
    execSync(`osascript "${tempScriptPath}"`, {
      stdio: "inherit",
      env: { ...process.env },
    });
  } catch (error) {
    throw new Error(`AppleScript execution failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  } finally {
    // Clean up temporary file
    try {
      unlinkSync(tempScriptPath);
    } catch {
      // Ignore cleanup errors
    }
  }
};

/**
 * Generate the common Cursor opening workflow (used by both project and leaf folder workflows)
 */
const generateCursorOpeningScript = (folderPath: string): string => {
  return `
    -- Exit Raycast immediately to prevent focus conflicts
    tell application "System Events"
      keystroke " " using {command down} -- CMD + SPACE to minimize Raycast
    end tell
    delay 0.5

    -- Open folder in Cursor
    do shell script "open -a Cursor \\"${folderPath}\\""
    delay 2

    -- Activate Cursor
    tell application "Cursor"
      activate
    end tell
    delay 1

  `;
};

/**
 * Generate the development workflow script (Cursor opening + terminal + dev command)
 */
const generateDevWorkflowScript = (projectPath: string, port: string, shouldOpenBrowser: boolean): string => {
  return `${generateCursorOpeningScript(projectPath)}
    -- Open integrated terminal using Command Palette (more reliable)
    tell application "System Events"
      keystroke "p" using {command down, shift down} -- Open Command Palette
      delay 0.5
      keystroke "View: Toggle Terminal" -- Type command
      delay 0.3
      key code 36 -- Press Enter
      delay 1
    end tell

    -- Send "bun run dev"
    set the clipboard to "bun run dev"
    delay 0.2
    tell application "System Events"
      keystroke "v" using {command down} -- paste
      delay 0.2
      key code 36 -- return
    end tell

    delay 2

    ${shouldOpenBrowser ? `
    -- Open Chrome on localhost
    do shell script "open -a 'Google Chrome' http://localhost:${port}"

    delay 2` : ''}
  `;
};

/**
 * Execute the complete development workflow
 * @param projectPath - Path to the project directory
 * @param port - Port number for development server
 * @param shouldOpenBrowser - Whether to open browser (only if port is detected)
 */
const executeCompleteWorkflow = (projectPath: string, port: string, shouldOpenBrowser: boolean = false): void => {
  const workflowScript = generateDevWorkflowScript(projectPath, port, shouldOpenBrowser);
  executeAppleScript(workflowScript);
};



const startDevWorkflow = async (project: Project) => {
  const preferences = getPreferenceValues<Preferences>();
  const port = project.port || preferences.defaultPort || "3010";

  try {
    await showToast({
      style: Toast.Style.Animated,
      title: "Starting development workflow...",
      message: `Setting up ${project.name}${project.port ? ` on port ${project.port}` : ''}`,
    });

    executeCompleteWorkflow(project.path, port, project.port !== null);

    await showToast({
      style: Toast.Style.Success,
      title: "Development workflow started!",
      message: `${project.name} setup in progress...`,
    });
  } catch (error) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Workflow failed",
      message: error instanceof Error ? error.message : "Unknown error occurred",
    });
  }
};

const getProjectIcon = (project: Project): Icon => {
  if (project.port) return Icon.Globe; // Port detected - web project
  if (project.hasBunLock) return Icon.Terminal; // Bun project
  if (project.hasPackageJson) return Icon.Document; // Node.js project
  return Icon.Folder; // Regular folder
};

const getProjectAccessories = (project: Project, recentFolders: Map<string, number>) => {
  const accessories = [];

  if (project.port) {
    accessories.push({ icon: Icon.Globe, text: `${project.port}` });
  }

  if (project.hasPackageJson) {
    accessories.push({ icon: Icon.Document, text: "package.json" });
  }

  if (project.hasBunLock) {
    accessories.push({ icon: Icon.Terminal, text: "bun" });
  }

  return accessories;
};

/**
 * Get keywords for recent folders to improve search ranking
 * This helps recently opened folders appear higher in Raycast search
 */
const getRecentFolderKeywords = (project: Project, recentFolders: Map<string, number>): string[] => {
  const timestamp = recentFolders.get(project.path);
  if (!timestamp) return [];

  const now = Date.now();
  const ageInHours = (now - timestamp) / (1000 * 60 * 60);

  // Add search boost keywords based on recency
  if (ageInHours < 1) return ["🔥 hot", "recent", "opened"];        // Last hour
  if (ageInHours < 6) return ["recent", "opened"];                   // Last 6 hours
  if (ageInHours < 24) return ["recent"];                            // Last day
  if (ageInHours < 72) return ["opened"];                            // Last 3 days
  return [];                                                         // Older folders
};

/**
 * Get items (folders or projects) at the current navigation path
 * Filters out dot folders and determines folder types
 */
const getItemsAtPath = (basePath: string, currentPath: string): Project[] => {
  try {
    const fullPath = join(basePath, currentPath);
    const items = readdirSync(fullPath);

    return items
      .filter((item) => {
        // Ignore folders starting with "."
        if (item.startsWith('.')) return false;

        const itemPath = join(fullPath, item);
        return statSync(itemPath).isDirectory();
      })
      .map((folderName) => {
        const projectPath = join(fullPath, folderName);

        // Find package.json recursively (in current or parent directories)
        const packageJsonPath = findPackageJson(projectPath);
        const hasPackageJson = packageJsonPath !== null;

        // Check for bun.lock in the project directory
        const bunLockPath = join(projectPath, "bun.lock");
        const hasBunLock = existsSync(bunLockPath);

        // Extract port from package.json if found
        const port = packageJsonPath ? extractPortFromPackageJson(packageJsonPath) : null;

        // Check if this folder has valid subfolders (non-dot folders)
        const hasValidSubfoldersValue = hasValidSubfolders(projectPath);

        return {
          name: folderName,
          path: projectPath,
          packageJsonPath,
          hasPackageJson,
          hasBunLock,
          port,
          hasValidSubfolders: hasValidSubfoldersValue,
          isLeafFolder: !hasPackageJson && !hasValidSubfoldersValue,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error("Error scanning items:", error);
    return [];
  }
};

/**
 * Check if a folder has valid subfolders (non-dot folders, making it navigable)
 */
const hasValidSubfolders = (folderPath: string): boolean => {
  try {
    const items = readdirSync(folderPath);
    return items.some((item) => {
      // Ignore dot folders
      if (item.startsWith('.')) return false;

      const itemPath = join(folderPath, item);
      return statSync(itemPath).isDirectory();
    });
  } catch {
    return false;
  }
};

/**
 * Track when a folder is opened
 */
const trackFolderOpened = async (folderPath: string, onUpdate?: () => void): Promise<void> => {
  try {
    const recentFoldersJson = await LocalStorage.getItem<string>("recentFolders");
    const recentFolders: Array<{ path: string; timestamp: number }> = recentFoldersJson
      ? JSON.parse(recentFoldersJson)
      : [];

    // Remove existing entry for this folder
    const filteredFolders = recentFolders.filter(folder => folder.path !== folderPath);

    // Add to the beginning with current timestamp
    const updatedFolders = [
      { path: folderPath, timestamp: Date.now() },
      ...filteredFolders
    ].slice(0, 10); // Keep only the 10 most recent

    await LocalStorage.setItem("recentFolders", JSON.stringify(updatedFolders));

    // Call the update callback if provided
    if (onUpdate) {
      onUpdate();
    }
  } catch (error) {
    console.error("Error tracking folder:", error);
  }
};

/**
 * Get recently opened folders with their timestamps
 */
const getRecentFolders = async (): Promise<Map<string, number>> => {
  try {
    const recentFoldersJson = await LocalStorage.getItem<string>("recentFolders");
    if (!recentFoldersJson) return new Map();

    const recentFolders: Array<{ path: string; timestamp: number }> = JSON.parse(recentFoldersJson);
    return new Map(recentFolders.map(folder => [folder.path, folder.timestamp]));
  } catch (error) {
    console.error("Error getting recent folders:", error);
    return new Map();
  }
};

/**
 * Sort items by recent usage, with recently opened folders first
 */
const sortItemsByRecentUsage = (items: Project[], recentFolders: Map<string, number>): Project[] => {
  return [...items].sort((a, b) => {
    const aTimestamp = recentFolders.get(a.path) || 0;
    const bTimestamp = recentFolders.get(b.path) || 0;

    // Sort by timestamp (most recent first), then by name
    if (aTimestamp !== bTimestamp) {
      return bTimestamp - aTimestamp; // Most recent first
    }
    return a.name.localeCompare(b.name);
  });
};

/**
 * Navigation component for browsing project folders
 */
function ProjectNavigation() {
  const preferences = getPreferenceValues<Preferences>();
  const [currentPath, setCurrentPath] = useState("");
  const [recentFolders, setRecentFolders] = useState<Map<string, number>>(new Map());
  const navigation = useNavigation();

  // Load recent folders on component mount
  useEffect(() => {
    getRecentFolders().then(setRecentFolders);
  }, []);

  // Function to refresh recent folders
  const refreshRecentFolders = async () => {
    const updatedRecentFolders = await getRecentFolders();
    setRecentFolders(updatedRecentFolders);
  };

  const items = getItemsAtPath(preferences.devFolderPath, currentPath);
  const sortedItems = sortItemsByRecentUsage(items, recentFolders);
  const pathSegments = currentPath.split("/").filter(Boolean);
  const canGoBack = pathSegments.length > 0;

  // Generate breadcrumb title
  const getBreadcrumbTitle = () => {
    if (pathSegments.length === 0) return "Development Projects";
    return pathSegments[pathSegments.length - 1];
  };

  const getBreadcrumbSubtitle = () => {
    if (pathSegments.length === 0) return `${sortedItems.length} items found`;
    return `${sortedItems.length} items • ${pathSegments.join(" › ")}`;
  };

  if (sortedItems.length === 0) {
    return (
      <List>
        <List.Item
          icon={Icon.Warning}
          title="No items found"
          subtitle={canGoBack ? "This folder is empty" : `Check your dev folder: ${preferences.devFolderPath}`}
          actions={
            canGoBack ? (
              <ActionPanel>
                <Action
                  title="Go Back"
                  icon={Icon.ArrowLeft}
                  onAction={() => {
                    const newPath = pathSegments.slice(0, -1).join("/");
                    setCurrentPath(newPath);
                  }}
                />
              </ActionPanel>
            ) : undefined
          }
        />
      </List>
    );
  }

  return (
    <List>
      <List.Section title={getBreadcrumbTitle()} subtitle={getBreadcrumbSubtitle()}>
        {canGoBack && (
          <List.Item
            key=".."
            icon={Icon.ArrowLeft}
            title=".."
            subtitle="Go back"
            keywords={["navigation", "back"]}
            actions={
              <ActionPanel>
                <Action
                  title="Go Back"
                  icon={Icon.ArrowLeft}
                  onAction={() => {
                    const newPath = pathSegments.slice(0, -1).join("/");
                    setCurrentPath(newPath);
                  }}
                />
              </ActionPanel>
            }
          />
        )}

        {sortedItems.map((item) => {
          const isNavigable = !item.hasPackageJson && item.hasValidSubfolders;
          const isLeafFolder = item.isLeafFolder;

          // Simplified icon logic: only show folder icon for navigable folders
          const icon = isNavigable ? Icon.Folder : undefined;

          // Show accessories for all items, but only show project-specific ones for non-navigable items
          const projectAccessories = isNavigable || isLeafFolder ? [] : getProjectAccessories(item, recentFolders);

          // Add star icon for recently opened folders (all types)
          const recentAccessories = [];
          const timestamp = recentFolders.get(item.path);
          if (timestamp) {
            const now = Date.now();
            const ageInHours = (now - timestamp) / (1000 * 60 * 60);
            if (ageInHours < 1) {
              recentAccessories.push({ icon: Icon.Star, text: "" });
            }
          }

          const accessories = [...projectAccessories, ...recentAccessories];
          const keywords = getRecentFolderKeywords(item, recentFolders);

          return (
            <List.Item
              key={item.path}
              icon={icon}
              title={item.name}
              subtitle={
                isNavigable
                  ? `${item.path.split("/").pop()} (folder)`
                  : isLeafFolder
                  ? `${item.path} (empty folder)`
                  : item.path
              }
              accessories={accessories}
              keywords={keywords}
              actions={
                <ActionPanel>
                  {isNavigable ? (
                    <Action
                      title="Navigate to Folder"
                      icon={Icon.ChevronRight}
                      onAction={() => {
                        const relativePath = currentPath ? `${currentPath}/${item.name}` : item.name;
                        setCurrentPath(relativePath);
                      }}
                    />
                  ) : (
                    <>
                      <Action
                        title={isLeafFolder ? "Open Folder in Cursor" : "Start Development Workflow"}
                        icon={Icon.Play}
                        onAction={async () => {
                          if (isLeafFolder) {
                            // Track folder usage for leaf folders
                            await trackFolderOpened(item.path, refreshRecentFolders);

                            // For leaf folders, just open in Cursor without running dev workflow
                            await showToast({
                              style: Toast.Style.Animated,
                              title: "Opening folder...",
                              message: `Opening ${item.name} in Cursor`,
                            });

                            const workflowScript = generateCursorOpeningScript(item.path);

                            executeAppleScript(workflowScript);

                            await showToast({
                              style: Toast.Style.Success,
                              title: "Folder opened!",
                              message: `${item.name} opened in Cursor`,
                            });
                          } else {
                            // Track folder usage for development workflow
                            await trackFolderOpened(item.path, refreshRecentFolders);
                            await startDevWorkflow(item);
                          }
                        }}
                      />
                      <Action.ShowInFinder title="Open in Finder" path={item.path} />
                      <Action.CopyToClipboard title="Copy Path" content={item.path} />
                    </>
                  )}
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>
    </List>
  );
}

export default function Command() {
  return <ProjectNavigation />;
}
