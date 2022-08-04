import * as React from "react";
import * as ReactDOM from "react-dom";

import "./index.css";
import { HexTable } from "./hex-elements";

declare global {
  interface Window {
    acquireVsCodeApi(): any;
    initialData: string;
  }
}

const vscode = window.acquireVsCodeApi();
const bytes = new Uint8Array(2*1024);
for (let ix = 0; ix < bytes.length; ix++) {
  bytes[ix] = Math.floor(Math.random() * 255) & 0xff;
}

ReactDOM.render(
  <HexTable vscode={vscode} bytes={bytes} address={0n} byteOffset={0} numBytes={bytes.length} dirty={false} />,
  // <p>This is an example of a simple HTML page with one paragraph.</p>,
  document.getElementById("root")
);
