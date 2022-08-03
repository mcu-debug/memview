import * as React from "react";
import * as ReactDOM from "react-dom";

import "./index.css";
import { HexTable } from "./hex-elements";

declare global {
  interface Window {
    acquireVsCodeApi(): any;
    initialData: Uint8Array;
  }
}

const vscode = window.acquireVsCodeApi();
const bytes = window.initialData;

ReactDOM.render(
  <HexTable vscode={vscode} bytes={bytes} address={0n} byteOffset={0} numBytes={0} dirty={false} />,
  document.getElementById("root")
);
