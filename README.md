# memview

This is a memory viewer extension specially built to work with debuggers. It can be used with any debugger that supports memory reads (and optional writes). Currently `cppdbg`, `cortex-debug` and `cspy` are the debuggers supported. This extension is more suitable for low level programmers or embedded developers. The debugger has to support the [Debug Adapter Protocol](https://microsoft.github.io/debug-adapter-protocol/). This protocol specifies how to make/format requests and responses. However it does not say what happens when a request fails so there may be issues in failure conditions -- we try our best to recover

## Features

This was originally conceived as part of the [Cortex-Debug](https://github.com/Marus/cortex-debug) extension. But we decided to make it a stand-alone extension so it can be useful for other debuggers. The design goals are [documented here](https://github.com/Marus/cortex-debug/wiki/Memory-Viewer)

We would like to eventually launch memory views from the Variables and Watch windows. But this will require some cooperation from core VSCode.

## Usage

* Use the Command Palette and select `MemoryView: Add new memory view...` while a debug session is paused.
* It will ask you for an address or a C-style expression that can be interpretted by the debugger to return an address. In expressions, try to use
* When successfully attached, a `MEMORY` tab will appear in the Panel area
