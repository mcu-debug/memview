/* eslint-disable @typescript-eslint/naming-convention */
import * as React from "react";
import { myGlobals } from "./globals";

type OnCellChangeFunc = (address: bigint, val: number) => void
interface IHexCell {
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
  // const id = `hex-cell-value-${props.address}`;

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
    <span
      className={classNames}
      contentEditable={myGlobals.isReadonly}
      onChange={onValueChanged}
    >
      {valueStr}
    </span>
  );
}

export const HexCellAddress: React.FC<{ address: bigint }> = ({
  address,
}) => {
  const classNames = "hex-cell hex-cell-address";
  // const id = `hex-cell-address-${address}`;
  const valueStr = address.toString(16).padStart(16, "0").padEnd(18, " ");
  return (
    < span className={classNames}>
      {valueStr}
    </span>
  );
};

export const HexCellChar: React.FunctionComponent<{
  address: bigint;
  val: number;
}> = ({ val }) => {
  const classNames = "hex-cell hex-cell-char";
  // const id = `hex-cell-char-${address}`;
  const valueStr = charCodesLookup[(val >>> 0) & 0xff];
  return (
    < span className={classNames}>
      {valueStr}
    </ span>
  );
};

export const HexCellEmpty: React.FunctionComponent<{
  length: number;
}> = ({ length = 1 }) => {
  const classNames = "hex-cell";
  const valueStr = " ".repeat(length);
  return (
    < span className={classNames}>
      {valueStr}
    </ span>
  );
};

export const HexCellEmptyHeader: React.FunctionComponent<{
  length?: number;
	fillChar?: string;
  cls?: string
}> = ({ length = 1, fillChar = " ", cls= "" }) => {
  const classNames = `hex-cell hex-cell-char-header ${cls}`;
  const valueStr = fillChar.repeat(length);
  return (
    < span
      className={classNames}
    >
      {valueStr}
    </ span>
  );
};

export const HexCellValueHeader: React.FunctionComponent<{
  value: number;
}> = ({ value }) => {
  const classNames = "hex-cell hex-cell-value-header";
  // const id = `hex-cell-value-header-${value}`;
  const valueStr = hexValuesLookup[(value >>> 0) & 0xff];
  return (
    < span className={classNames}>
      {valueStr}
    </ span>
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
		decodedText.push(" ");
	}
  return (
    <div className={classNames}>
      <HexCellEmptyHeader key={1} length={18} fillChar="." cls={"hex-cell-address hex-cell-address-empty"} />
      {ary.map((v, i) => {
        return <HexCellValueHeader key={i + 2} value={v}/>;
      })}
      {decodedText.map((v, i) => {
        return <HexCellEmptyHeader key={i + 18} fillChar={v} />;
      })}
    </div>
  );
}

interface IHexDataRow {
  address: bigint;
  byteOffset: number;
  dirty: boolean;
  mask: number;
  onChange?: OnCellChangeFunc
}

export function HexDataRow(props: IHexDataRow): JSX.Element {
  const classNames = "hex-data-row";
  const values = [];
  const chars = [];
  for (let ix = 0; ix < 16; ix++) {
    const val = myGlobals.bytes && (props.mask & (1 << ix)) ? myGlobals.bytes[props.byteOffset + ix] : -1;
    const ixx = BigInt(ix);
    values.push(
      <HexCellValue
        key={ix + 2}
        address={props.address + ixx}
        value={val}
        dirty={props.dirty}
        onChange={props.onChange}
      />
    );
    chars.push(
      <HexCellChar address={props.address + ixx} val={val} key={ix + 18}/>
    );
  }
  return (
    <div className={classNames}>
      <HexCellAddress key={1} address={props.address} />
      <div>
        {values}
        {chars}
      </div>
    </div>
  );
}

export interface IHexTable {
  address: bigint; // Address of first byte ie. bytes[byteOffset];
  byteOffset: number;
  numBytes: number; // Must be a multiple of 16
  dirty: boolean;
  onChange?: OnCellChangeFunc
}

export function HexTable(props: IHexTable): JSX.Element {
  const numBytes = (props.numBytes / 16) * 16;
  const endAddr = props.address + BigInt(numBytes);
  const header = <HexHeaderRow key="h" address={props.address}/>;
  const rows = [];
  let offset = props.byteOffset;
  for (
    let addr = props.address;
    addr < endAddr;
    addr += 16n, offset += 16
  ) {
    rows.push(
      <HexDataRow
        key={offset}
        address={addr}
        byteOffset={offset}
        dirty={props.dirty}
        mask={0xffff}
        onChange={props.onChange}
      />
    );
  }
  return <div id="hex-grid" className="hex-grid">
    {header}
    <div className='hex-data-rows'>{rows}</div>
    </div>;
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
