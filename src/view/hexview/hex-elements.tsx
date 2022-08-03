/* eslint-disable @typescript-eslint/naming-convention */
import * as React from "react";
import {
  VSCodeDataGridCell,
  VSCodeDataGridRow,
  VSCodeDataGrid,
} from "@vscode/webview-ui-toolkit/react";

type OnCellChangeFunc = (address: bigint, val: number) => void
interface IHexCell {
  vscode: any;
  column: number;
  address: bigint;
  value: number;
  dirty: boolean;
  onChange?: OnCellChangeFunc
}

export function HexCellValue(props: IHexCell): JSX.Element {
  const [value, setValue] = React.useState(props.value);

  const classNames =
    "hex-cell hex-cell-value" +
    (props.dirty ? " hex-cell-value-dirty" : "") +
    (props.value !== value ? " hex-cell-value-changed" : "");
  const id = `hex-cell-value-${props.address}`;

  const onValueChanged = (event: any) => {
    let val = (event.target.value as string).trim().toLowerCase();
    while (val.startsWith("0x")) {
      val = val.substring(2);
    }
    while (val.length > 1 && val.startsWith("0")) {
      val = val.substring(1);
    }
    if (val.length > 2 || val.length === 0 || /[0-9a-f]]/.test(val)) {
      return;
    }
    const intVal = parseInt(val, 16);
    if (value !== intVal) {
      if (props.onChange) {
        props.onChange(props.address, intVal);
      }
      setValue(intVal);
    }
  };

  const valueStr = value < 0 ? "--" : hexValuesLookup[(value >>> 0) & 0xff];
  return (
    <VSCodeDataGridCell
      id={id}
      className={classNames}
      grid-column={props.column}
      contentEditable="true"
      onChange={onValueChanged}
    >
      {valueStr}
    </VSCodeDataGridCell>
  );
}

export const HexCellAddress: React.FC<{ address: bigint }> = ({
  address,
}) => {
  const classNames = "hex-cell hex-cell-address";
  const id = `hex-cell-address-${address}`;
  const valueStr = address.toString(16).padStart(16, "0");
  return (
    <VSCodeDataGridCell id={id} className={classNames} grid-column="0">
      {valueStr}
    </VSCodeDataGridCell>
  );
};

export const HexCellChar: React.FunctionComponent<{
  address: bigint;
  val: number;
  column: number;
}> = ({ address, val, column }) => {
  const classNames = "hex-cell hex-cell-char";
  const id = `hex-cell-char-${address}`;
  const valueStr = charCodesLookup[(val >>> 0) & 0xff];
  return (
    <VSCodeDataGridCell id={id} className={classNames} grid-column={column}>
      {valueStr}
    </VSCodeDataGridCell>
  );
};

export const HexCellEmpty: React.FunctionComponent<{
  column: number;
  length: number;
}> = ({ column, length = 1 }) => {
  const classNames = "hex-cell hex-cell-empty";
  const valueStr = "&nbsp".repeat(length);
  return (
    <VSCodeDataGridCell className={classNames} grid-column={column}>
      {valueStr}
    </VSCodeDataGridCell>
  );
};

export const HexCellEmptyHeader: React.FunctionComponent<{
  column: number;
  length?: number;
	fillChar?: string;
}> = ({ column, length = 1, fillChar = "&nbsp" }) => {
  const classNames = "hex-cell hex-cell-empty";
  const valueStr = fillChar.repeat(length);
  return (
    <VSCodeDataGridCell
      className={classNames}
      cell-type="columnheader"
      grid-column={column}
    >
      {valueStr}
    </VSCodeDataGridCell>
  );
};

export const HexCellValueHeader: React.FunctionComponent<{
  value: number;
  column: number;
}> = ({ value: val, column }) => {
  const classNames = "hex-cell hex-cell-value-header";
  const id = `hex-cell-value-header-${val}`;
  const valueStr = charCodesLookup[(val >>> 0) & 0xff];
  return (
    <VSCodeDataGridCell id={id} className={classNames} grid-column={column}>
      {valueStr}
    </VSCodeDataGridCell>
  );
};

interface IHexHeaderRow {
	address: bigint
}

export function HexHeaderRow(props: IHexHeaderRow): JSX.Element {
  const classNames = "hex-header-row";
	const ary = [];
	// let lowByte = Number(props.address % 16n);
	let lowByte = Number(BigInt.asUintN(8, props.address));
	for (let x = 0; x < 16; x++, lowByte++) {
		ary.push(lowByte & 0xff);
	}
	const decodedText = "Decoded Bytes".split("");
	for (let x = decodedText.length; x < 16; x++) {
		decodedText.push("&nbsp");
	}
  return (
    <VSCodeDataGridRow className={classNames}>
      <HexCellEmptyHeader column={0} length={16} />
      {ary.map((v, i) => {
        return <HexCellValueHeader value={v} column={i + 2} />;
      })}
      {decodedText.map((v, i) => {
        return <HexCellEmptyHeader column={i + 18} fillChar={v} />;
      })}
    </VSCodeDataGridRow>
  );
}

interface IHexDataRow {
  vscode: any;
  address: bigint;
  bytes: Uint8Array;
  byteOffset: number;
  dirty: boolean;
  mask: number;
  onChange?: OnCellChangeFunc
}

export function HexDataRow(props: IHexDataRow): JSX.Element {
  const classNames = "hex-header-row";
  const values = [];
  const chars = [];
  for (let ix = 0; ix < 16; ix++) {
    const val = props.mask & ix ? props.bytes[props.byteOffset + ix] : -1;
    const ixx = BigInt(ix);
    values.push(
      <HexCellValue
        vscode={props.vscode}
        column={ix + 2}
        address={props.address + ixx}
        value={val}
        dirty={props.dirty}
        onChange={props.onChange}
      />
    );
    chars.push(
      <HexCellChar address={props.address + ixx} val={val} column={ix + 18} />
    );
  }
  return (
    <VSCodeDataGridRow className={classNames}>
      <HexCellAddress address={props.address} />
      {values}
      {chars}
    </VSCodeDataGridRow>
  );
}

export interface IHexTable {
  vscode: any;
  address: bigint; // Address of first byte ie. bytes[byteOffset];
  bytes: Uint8Array;
  byteOffset: number;
  numBytes: number; // Must be a multiple of 16
  dirty: boolean;
  onChange?: OnCellChangeFunc
}

export function HexTable(props: IHexTable): JSX.Element {
  props.numBytes = (props.numBytes / 16) * 16;
  const endAddr = props.address + BigInt(props.numBytes);
  const rows = [<HexHeaderRow address={props.address} />];
  for (
    let addr = props.address;
    addr < endAddr;
    addr += 16n, props.byteOffset + 16
  ) {
    rows.push(
      <HexDataRow
        vscode={props.vscode}
        address={addr}
        bytes={props.bytes}
        byteOffset={props.byteOffset}
        dirty={props.dirty}
        mask={0xffff}
        onChange={props.onChange}
      />
    );
  }
  return <VSCodeDataGrid>{rows}</VSCodeDataGrid>;
}

const charCodesLookup: string[] = [];
const hexValuesLookup: string[] = [];
for (let byte = 0; byte <= 255; byte++) {
  const v =
    byte <= 32 || (byte >= 127 && byte <= 159)
      ? "."
      : String.fromCharCode(byte);
  charCodesLookup.push(v);
  hexValuesLookup.push(byte.toString(16).padStart(2, "0"));
}

function bigIntMax(a: bigint, b: bigint) {
  return a > b ? a : b;
}
function bigIntMin(a: bigint, b: bigint) {
  return a < b ? a : b;
}
