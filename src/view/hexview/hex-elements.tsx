/* eslint-disable @typescript-eslint/naming-convention */
import * as React from "react";
import { myGlobals, frozenState } from "./globals";
import {
  RecoilRoot,
  atom,
  selector,
  useRecoilState,
  useRecoilValue,
  useSetRecoilState,
} from "recoil";
import { useEffect } from "react";

type OnCellChangeFunc = (address: bigint, val: number) => void;
interface IHexCell {
  address: bigint;
  value: number;
  dirty: boolean;
  onChange?: OnCellChangeFunc;
}

export function HexCellValue(props: IHexCell): JSX.Element {
  const [frozen, _setFrozen] = useRecoilState<boolean>(frozenState);
  const [value, setValue] = React.useState(props.value);

  const classNames =
    "hex-cell hex-cell-value" +
    (props.dirty || frozen ? " hex-cell-value-dirty" : "") +
    (props.value !== value ? " hex-cell-value-changed" : "");

  const onValueChanged = (val: string) => {
    val = val.trim().toLowerCase();
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

  const handleClick = (event: any) => {
    switch (event.detail) {
      case 1: {
        console.log("single click");
        break;
      }
      case 2: {
        console.log("double click");
        openPopup(event);
        break;
      }
      case 3: {
        console.log("triple click");
        break;
      }
      default: {
        break;
      }
    }
  };

  const openPopup = (event: any) => {
    const props: IHexCellEditProps = {
      trigger: false,
      clientX: event.clientX,
      clientY: event.clientY,
      value: valueStr(),
      callback: onPopupDone
    };
    console.log('calliing poppu');
    try {
      PopupHexCellEdit.open(event, props);
    }
    catch (e) {
      console.log(`popup exception ${e}`);
    }
  };

  const onPopupDone = (v: string | undefined) => {
    console.log(`onPopupDone called '${v}'`);
    if (v != null) {
      onValueChanged(v);
    }
  };

  const valueStr = () => {
    return value < 0 ? "--" : hexValuesLookup[(value >>> 0) & 0xff];
  };

  const editable = !frozen && !myGlobals.isReadonly;
  return (
    <div className={classNames}>
      <span onClick={editable ? handleClick : undefined}>{valueStr()}</span>
    </div>
  );
  /*
   return (
     <span className={classNames} onClick={handleClick}>{valueStr}</span>
   );
   */
}

export const HexCellAddress: React.FC<{ address: bigint }> = ({ address }) => {
  const classNames = "hex-cell hex-cell-address";
  // const id = `hex-cell-address-${address}`;
  const valueStr = address.toString(16).padStart(16, "0").padEnd(18, " ");
  return <span className={classNames}>{valueStr}</span>;
};

export const HexCellChar: React.FunctionComponent<{
  address: bigint;
  val: number;
}> = ({ val }) => {
  const classNames = "hex-cell hex-cell-char";
  // const id = `hex-cell-char-${address}`;
  const valueStr = charCodesLookup[(val >>> 0) & 0xff];
  return <span className={classNames}>{valueStr}</span>;
};

export const HexCellEmpty: React.FunctionComponent<{
  length: number;
}> = ({ length = 1 }) => {
  const classNames = "hex-cell";
  const valueStr = " ".repeat(length);
  return <span className={classNames}>{valueStr}</span>;
};

export const HexCellEmptyHeader: React.FunctionComponent<{
  length?: number;
  fillChar?: string;
  cls?: string;
}> = ({ length = 1, fillChar = " ", cls = "" }) => {
  const classNames = `hex-cell hex-cell-char-header ${cls}`;
  const valueStr = fillChar.repeat(length);
  return <span className={classNames}>{valueStr}</span>;
};

export const HexCellValueHeader: React.FunctionComponent<{
  value: number;
}> = ({ value }) => {
  const classNames = "hex-cell hex-cell-value-header";
  // const id = `hex-cell-value-header-${value}`;
  const valueStr = hexValuesLookup[(value >>> 0) & 0xff];
  return <span className={classNames}>{valueStr}</span>;
};

interface IHexHeaderRow {
  address: bigint;
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
      <HexCellEmptyHeader
        key={1}
        length={18}
        fillChar="."
        cls={"hex-cell-address hex-cell-address-empty"}
      />
      {ary.map((v, i) => {
        return <HexCellValueHeader key={i + 2} value={v} />;
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
  onChange?: OnCellChangeFunc;
}

export function HexDataRow(props: IHexDataRow): JSX.Element {
  const classNames = "hex-data-row";
  const values = [];
  const chars = [];
  for (let ix = 0; ix < 16; ix++) {
    const val =
      myGlobals.bytes && props.mask & (1 << ix)
        ? myGlobals.bytes[props.byteOffset + ix]
        : -1;
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
      <HexCellChar address={props.address + ixx} val={val} key={ix + 18} />
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
  onChange?: OnCellChangeFunc;
}

export function HexTable(props: IHexTable): JSX.Element {
  const numBytes = (props.numBytes / 16) * 16;
  const endAddr = props.address + BigInt(numBytes);
  const header = <HexHeaderRow key="h" address={props.address} />;
  const rows = [];
  let offset = props.byteOffset;
  for (let addr = props.address; addr < endAddr; addr += 16n, offset += 16) {
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
  return (
    <div id="hex-grid" className="hex-grid">
      {header}
      <div className="hex-data-rows">{rows}</div>
      <PopupHexCellEdit {...PopupHexCellEdit.globalProps}></PopupHexCellEdit>
    </div>
  );
}

interface IHexCellEditProps {
  trigger: boolean;
  clientX: number;
  clientY: number;
  value: string;
  callback: (value: string | undefined) => void;
}
interface IHexCellEditState {
  isOpen: boolean;
  value: string
}
// This is a modification of what I found here
// https://jasonwatmore.com/post/2018/01/23/react-custom-modal-window-dialog-box
export class PopupHexCellEdit extends React.Component<IHexCellEditProps, IHexCellEditState> {
  static globalModel: PopupHexCellEdit | undefined;
  static globalProps: IHexCellEditProps = {    // Can also be used as defaultProps
    trigger: false,
    clientX: 0,
    clientY: 0,
    value: "",
    callback: function (_value: string | undefined): void {
      throw new Error("Function not implemented.");
    },
  };
  private static onKeyDownFunc: any;
  private static inputElementId = "PopupHexCellEdit.input";
  private handleClickFunc: any;
  private onChangeFunc: any;
  private lastGoodValue = '';

  static open(e: any, props: IHexCellEditProps) {
    console.log('popup:open called');
    e && e.preventDefault();
    if (PopupHexCellEdit.globalModel) {
      Object.assign(PopupHexCellEdit.globalProps, props);
      PopupHexCellEdit.globalModel.lastGoodValue = props.value;
      console.log(`1. InPopup Initial value = '${PopupHexCellEdit.globalModel.lastGoodValue}'`);
      PopupHexCellEdit.globalModel.setState({ isOpen: true, value: props.value });
      // document.body.classList.add("jw-modal-open");
      document.addEventListener("keydown", PopupHexCellEdit.onKeyDownFunc, false);
    } else {
      throw new Error("PopupHexCellEdit: no global model defined before calling open");
    }
  }

  static close(e: any) {
    e && e.preventDefault();
    if (PopupHexCellEdit.globalModel) {
      // close modal specified by id
      PopupHexCellEdit.globalModel.setState({ isOpen: false });
      // document.body.classList.remove("jw-modal-open");
      document.removeEventListener("keydown", PopupHexCellEdit.onKeyDownFunc, false);
    } else {
      throw new Error("PopupHexCellEdit: no global model defined when calling close");
    }
  }

  constructor(props: IHexCellEditProps) {
    super(props);
    if (PopupHexCellEdit.globalModel) {
      throw new Error('IHexCellEditProps is a singleton. Cannot call this multiple times without unmounting first');
    }
    Object.assign(PopupHexCellEdit.globalProps, props);
    this.state = { isOpen: false, value: '' };
    this.handleClickFunc = this.handleClick.bind(this);
    this.onChangeFunc = this.onChange.bind(this);
    PopupHexCellEdit.onKeyDownFunc = this.onKeyDown.bind(this);
  }

  componentDidMount() {
    // move element to bottom of page (just before </body>) so it can be displayed above everything else
    // document.body.appendChild((this as any).element);

    // We are now ready for open/close
    PopupHexCellEdit.globalModel = this;
  }

  componentWillUnmount() {
    PopupHexCellEdit.globalModel = undefined;
  }

  handleClick(e: any) {
    // close modal on background click
    if (e.target.className === "jw-modal") {
      PopupHexCellEdit.globalProps.callback(undefined);
      PopupHexCellEdit.close(e);
    }
  }

  private onChange(event: any) {
    const v = event.target.value;
    console.log(`On Change ${v}`);
    this.setState({ value: v });
    if (!/[0-9a-fA-f]{0,2}/.test(v)) {
      // The patter on the input element does not work because it is not in a form
      // Onm case, it doesn't we do our own.
      console.log(`3. InPopup Rejected value = '${v}'`);
      event.target.value = this.lastGoodValue;
    } else {
      this.lastGoodValue = event.target.value;
    }
    console.log(`4. InPopup NextValue = '${v}'`);
  }

  public onKeyDown(event: any) {
    let v: string | undefined = undefined;
    if (event.key === "Enter") {
      v = this.lastGoodValue;
    } else if (event.key !== "Escape") {
      return;
    }
    PopupHexCellEdit.globalProps.callback(v);
    PopupHexCellEdit.close(event);
  }

  render() {
    return (
      <div
        style={{ display: +(this.state as any).isOpen ? "" : "none" }}
        onClick={this.handleClickFunc}
        ref={(el) => ((this as any).element = el)}
      >
        <div className="jw-modal">
          <div className="jw-modal-body">
            <div
              id={`Popup-1234`}
              className="popup"
              style={{ top: PopupHexCellEdit.globalProps.clientY, left: PopupHexCellEdit.globalProps.clientX }}
            >
              <input
                id={PopupHexCellEdit.inputElementId}
                autoFocus
                type="text"
                maxLength={2}
                pattern="[0-9a-fA-F]{1,2}"
                value={this.state.value}
                onChange={this.onChangeFunc}
              ></input>
            </div>
            {this.props.children}
          </div>
        </div>
        <div className="jw-modal-background"></div>
      </div>
    );
  }

  /*
  render() {
    return (
      <div
        className="popup"
        style={{ display: +this.state.isOpen ? "" : "none", top: PopupHexCellEdit.globalProps.clientY, left: PopupHexCellEdit.globalProps.clientX }}
      >
        <input
          id={PopupHexCellEdit.inputElementId}
          autoFocus
          type="text"
          maxLength={2}
          pattern="[0-9a-fA-F]{1,2}"
          style= {{ width: "4ch" }}
          value={this.state.value}
          onChange={this.onChangeFunc}
        ></input>
      </div>
    );
  }
  */
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

/*
function bigIntMax(a: bigint, b: bigint) {
  return a > b ? a : b;
}
function bigIntMin(a: bigint, b: bigint) {
  return a < b ? a : b;
}
*/
