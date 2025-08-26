# Code Session - Raycast Development Workflow Automation

A Raycast extension that automates your complete development workflow setup with proper focus management and application control.

## Features

### 🔍 Project Discovery

- Automatically scans your configured development folder
- Displays projects with smart icons:
  - 🔧 Projects with `bun.lock` (Bun projects)
  - 📄 Projects with `package.json` (npm/Node projects)
  - 📁 Regular folders
- Shows project metadata and status

### ⚡ Complete Workflow Automation

When you select a project, the extension will:

1. **Open project** in Cursor editor
2. **Open integrated terminal** (Ctrl+Shift+~)
3. **Execute `bun run dev`** in the terminal
4. **Position Cursor** window to left side (Ctrl+Option+←)
5. **Open Chrome** to localhost with your configured port
6. **Position Chrome** to right side (Ctrl+Option+→)
7. **Start focus session** (Ctrl+Option+Shift+F)

## Configuration

### Required Settings

Set these in Raycast preferences for the extension:

- **Development Folder Path**: Path to your projects folder (default: `/Users/matheus/Desktop/dev`)
- **Default Port**: Development server port (default: `3010`)

### Focus Management Solution ✅

**The Problem**: Raycast's `runAppleScript` utility doesn't properly transfer focus to other applications, causing commands to execute in Raycast's context instead of the target application.

**The Solution**: **Claude-Recommended Focus Management**

Based on Claude's analysis, we now use **advanced focus management techniques**:

1. **`open --activate` Flag**: Uses macOS built-in focus transfer mechanism
2. **Process-Specific Keystrokes**: Sends keystrokes directly to application processes
3. **Frontmost Application Management**: Ensures target app is definitively frontmost
4. **Proper Timing**: Increased delays for application startup and focus transfer

#### Why This Works:

- **`--activate` Flag**: macOS native focus transfer mechanism
- **Process-Specific Commands**: Keystrokes sent to specific application processes
- **Frontmost Management**: `set frontmost to true` ensures proper focus
- **Increased Timing**: Gives applications time to fully launch and receive focus

## Usage

### Quick Start

1. **Install the extension**: Run `bun run dev` in the extension directory
2. **Configure preferences**: Set your dev folder path and default port in Raycast
3. **Search for "Start Coding Now"** in Raycast
4. **Select your project** from the list
5. **Click "Start Development Workflow"**
6. **Watch the automation** - works identically to your standalone script!
7. **Enjoy your automated setup!** 🚀

**Note**: Uses Claude's recommended focus management techniques for reliable application control.

### Workflow Steps in Detail

1. **Project Selection**: Browse your configured dev folder
2. **Confirmation**: Confirm before starting the workflow
3. **Progress Feedback**: Toast notifications for each step
4. **Complete Setup**: All applications positioned and ready

## Troubleshooting

### Focus Issues (SOLVED ✅)

**Problem**: Commands executing in Raycast instead of target applications

**Solution**: The extension now uses:

- **Single Comprehensive AppleScript**: Entire workflow in one script
- External AppleScript execution via `osascript`
- Direct application activation without Raycast interference
- Return focus to Raycast after completion

### Common Issues

#### 1. Projects Not Found

- Verify your **Development Folder Path** in preferences
- Ensure the folder exists and contains project directories
- Check that you have read permissions

#### 2. Commands Not Executing in Cursor

- This issue has been resolved with the enhanced focus management
- If problems persist, ensure Cursor is properly installed

#### 3. Port Issues

- Check your **Default Port** preference
- Ensure your development server uses the configured port
- Verify Chrome can access localhost:[port]

#### 4. Permission Issues

- The extension needs accessibility permissions for keyboard simulation
- Grant Raycast accessibility access in System Settings

## Technical Implementation

### Key Components

#### 1. Project Scanner

```typescript
const getProjects = (folderPath: string): Project[]
```

Scans the configured folder and detects project types based on:

- `package.json` presence
- `bun.lock` presence

#### 2. External AppleScript Execution

```typescript
const executeAppleScript = (script: string): void
```

- Writes AppleScript to temporary files
- Executes using `osascript` with system privileges
- Handles cleanup automatically

#### 3. Enhanced Focus Management

```typescript
const switchToApplication = (appName: string): void
```

- Hides Raycast completely
- Activates target application
- Sets application as frontmost
- Ensures proper focus transfer

### Dependencies

- `@raycast/api`: Core Raycast functionality
- `fs`: File system operations
- `child_process`: System command execution
- `path`: Path manipulation
- `os`: Temporary file management

## Development

### Building

```bash
bun install
bun run build
```

### Development Mode

```bash
bun run dev
```

### Linting

```bash
bun run lint
```

## License

MIT License - see package.json for details.
