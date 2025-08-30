# Change Log

Please note that we are still in Preview mode. For those using the API, this can change in the near future as we refine our proposals but it is getting more mature as it is being used in other extensions.

## [Unreleased]

-   Editing
-   ---Selection, copy &--- paste
-   Apply settings to workspace/user/all-views beyond the current view
-   Scrollbars: We are not happy about the scrollbars. While scrolling works with the track-pad or mouse-wheel, the scrollbars are not always visible. We hope to have proper scrollbars in the future and soon. The infinite scrolling makes scrollbars a bit tricky. Any help is appreciated if you are a HTML/CSS/React expert.

## 0.0.26 - Aug 30, 2025

-   [#40](https://github.com/mcu-debug/memview/issues/40): Add tracking of the mplab debugger by @xoriath
-   [#34](https://github.com/mcu-debug/memview/issues/34): Add custom column and custom size by @Lee20171010

## 0.0.25 - Nov 12, 2023

-   **Major change:** Now, there is a way to launch this memory viewer directly from the Variable/Watch windows. For debuggers that provide memory references. Most C/C++ debuggers do. See https://github.com/mcu-debug/memview/issues/25

## 0.0.24 - Jul 15, 2023

-   In some cases address expressions were not being evaluated properly
-   When copying, the last byte sometimes did not get copied

## 0.0.23 - Jul 15, 2023

-   [Refresh not done when a breakpoint is HIT #16](https://github.com/mcu-debug/memview/issues/16) Memory was not being updated when the transition from `stopped` to running to `stopped` happened very fast. We never noticed `running` transition and it looked like we went from stopped to stopped. Thus, no auto-refresh occurred. Generally not a problem with MCUs but was an issue with native code running on fast computers. The debounce existed because the React framework could not handle fast transitions and caused shimmering/flickering. If you see the shimmering, please let us know. So, this fix should be considered experimental.
-   Good news is that we now have a few non-embedded users for this extension.

## 0.0.22 - Jun 24, 2023

-   Added setting `memory-view.trackDebuggers` to add additional debuggers to track.

## 0.0.19 - Feb 2, 2022

-   Experimental: Added Rust Probe Debugger to the list of debuggers supported. https://github.com/probe-rs/probe-rs/tree/master/debugger
-   Fix [Issue#10 Misaligned rows when saving memory to file](https://github.com/mcu-debug/memview/issues/10)

## 0.0.18 - Nov 22, 2022

-   You can now use you mouse to select a range of cells using your mouse. A single left-click starts the selection and Shift-left-click will extend the selection
-   You can also copy the values to the system clipboard using the standard keyboard shortcut or the right-click context menu. Sorry, no paste within the viewer yet -- as that requires editing capabilities in this extension.
-   There is new button for the 'Copy' function as well. If you hold the Alt (Windows, Linux) or ⌥ (MacOS) it can copy `all` to clipboard. If the debugger is paused, we will try to refresh any data that may not be visible.
-   There is a new button for Saving the contents to a file
-   In all cases (copy to clipboard or file), the data is always saved in byte form regardless of the current view (4-byte or 8-byte)

## 0.0.17 - Nov 18, 2022

-   Fix for [Issue#9 Data regions are not refreshed synchronously](https://github.com/mcu-debug/memview/issues/9). Needed to force a refresh
-   Fix for when you change the editor font size, the data rows were not being resized accordingly. The data rows are now a tiny bit more compact as well

## 0.0.16 - Nov 12, 2022

-   Partial fix for [Issue#7 Not vertical layout friendly](https://github.com/mcu-debug/memview/issues/7). We still have a big problem with the header not scrolling horizontally with the content but the content is no longer cut-off/shrunk/etc. Experts in CSS/HTML/React are welcome to help us. We will eventually get this right.
-   Some minor changes to editing (sorry not ready yet but you can try editing) and tab navigation

## 0.0.15 - Oct 30, 2022

-   Fix for [Issue#7](https://github.com/mcu-debug/memview/issues/7). One consequence of this is that the vertical scrollbar may not be visible anymore because it is inside and to the far right. If you scroll right far enough, it is there. See note about scrollbars above
-   Some minor changes to editing (sorry not ready yet but you can try editing) and tab navigation

## 0.0.14 - Oct 11, 2022

-   vscode command `mcu-debug.memory-view.addMemoryView` now supports adding with expression and/or other options
-   Avoid duplicate views wither via URI or via mcu-debug.memory-view.addMemoryView. For something to be considered a duplicate, the expression has to match and if they exist as options, the workspaceFolder and the sessionName have to match. Other optional things are not compared.
-   Fixed Issue#1 STM32 memory locations off by 10 bytes. Actually, it was off by 0x10 bytes, bug introduced when we did the display for 4 and 8 byte grouping.

## 0.0.10 - Oct 7, 2022

-   Initial release, moved from haneefdm/memview to mcu-debug/memview

## 0.0.9 - Sep 3, 2022

-   Initial release of most of the view settings. Applying settings more globally is not yet implemented -- until we finalize a per view set of settings.
-   Introducing 4-byte and 8-byte grouping. However, these groupings, you will not get the Decoded bytes. Instead however, you will see 32-bytes of data per row whereas you see 16-bytes per row in 1-byte mode
-   For 4-byte and 8-byte grouping, we also support little/big endian conversion
-   The top-left of a memory view now shows the start-address of the view. Note that this is different from the base-address which is always a multiple of 16. So, you start-address and base-address can be slightly different and base-address <= start-address. The start-address will always be on the first row though.

![vew-properties](./resources/vew-props.png)
