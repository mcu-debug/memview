# memview

This is a memory viewer extension specially built to work with debuggers. It can be used with any debugger that supports memory reads (and optional writes). Currently `cppdbg`, `cortex-debug` and `cspy` are the debuggers supported. This extension is more suitable for low level programmers or embedded developers. The debugger has to support the [Debug Adapter Protocol](https://microsoft.github.io/debug-adapter-protocol/). This protocol specifies how to make/format requests and responses. However it does not say what happens when a request fails so there may be issues in failure conditions -- we try our best to recover.

Our goal is to provide a good memory viewer, editing memory is low in priority. For editing, we have not decided on what the usage paradimn is and how to do error recovery.

## Features

This was originally conceived as part of the [Cortex-Debug](https://github.com/Marus/cortex-debug) extension. But we decided to make it a stand-alone extension so it can be useful for other debuggers. The design goals are [documented here](https://github.com/Marus/cortex-debug/wiki/Memory-Viewer)

We would like to eventually launch memory views from the Variables and Watch windows. But this will require some cooperation from core VSCode.

## Usage

* Use the Command Palette and select `MemoryView: Add new memory view...` while a debug session is paused.
* It will ask you for an address or a C-style expression that can be interpretted by the debugger to return an address. In expressions, try to use global variables or else things might not work when we try to refresh the view
* When successfully attached, a `MEMORY` tab will appear in the Panel area
* All memory requests are aligned to a 16 byte boundary. The number of bytes is limited to 1MB but only 512 byte chucks are read and we only keep a small amount (two pages) of data in memory. Memory is fetched and rendered as need

* NOTE: Editing features are not yet ready for use. You can edit but the edits will not be saved to your program

Your views are preserved across restarts of VSCode window. They are saved on a workspace basis. We have three stages of a memory view
* `Orphaned`: Not connected to a debugger and will display the last seen values if they were ever extracted. Every time a new debug session starts (of the supported debuggers), we try to see if an orphaned memory view can be re-attached to the session. You will see an indication of that in the toolbar.
* `Busy`: Attached to the debugger but the program is busy. While it is busy, no updates to memory views can happen, while it is possible to read momory while the program is running, most gdb based debuggers do not allow this and we don't know which debuggers are capable of that.
* **`Paused`**: The program is in paused state and we are ready to update memory. A refresh is automatically done for visible areas and more data is fetched as needed
