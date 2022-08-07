/* eslint-disable @typescript-eslint/naming-convention */
import * as React from 'react';
import { myGlobals, frozenState } from './globals';
import * as Utils from './utils';
import {
    RecoilRoot,
    atom,
    selector,
    useRecoilState,
    useRecoilValue,
    useSetRecoilState
} from 'recoil';
import { useEffect } from 'react';

type OnCellChangeFunc = (address: bigint, byteOffset: number, val: number) => void;
interface IHexCell {
    address: bigint;
    byteOffset: number;
    dirty: boolean;
    onChange?: OnCellChangeFunc;
}

export function HexCellValue(props: IHexCell): JSX.Element {
    const inRange = addrInRange(props.address, props.byteOffset);
    const val = inRange ? myGlobals.bytes[props.byteOffset] : -1;
    const origVal = inRange ? myGlobals.origBytes[props.byteOffset] : -1;
    const [frozen] = useRecoilState<boolean>(frozenState);
    const [value, setValue] = React.useState(val);

    const classNames = () => {
        return (
            'hex-cell hex-cell-value' +
            (props.dirty || frozen ? ' hex-cell-value-dirty' : '') +
            (origVal !== value ? ' hex-cell-value-changed' : '')
        );
    };

    const onValueChanged = (val: string) => {
        val = val.trim().toLowerCase();
        while (val.startsWith('0x')) {
            val = val.substring(2);
        }
        while (val.length > 1 && val.startsWith('0')) {
            val = val.substring(1);
        }
        if (val.length > 2 || val.length === 0 || /[0-9a-f]]/.test(val)) {
            return;
        }
        const intVal = parseInt(val, 16);
        if (value !== intVal) {
            setValue(intVal);
            myGlobals.bytes[props.byteOffset] = intVal;
            if (props.onChange) {
                props.onChange(props.address, props.byteOffset, intVal);
            }
        }
    };

    const handleClick = (event: any) => {
        switch (event.detail) {
            case 1: {
                break;
            }
            case 2: {
                openPopup(event);
                break;
            }
            case 3: {
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
        try {
            PopupHexCellEdit.open(event, props);
        } catch (e) {
            console.log(`popup exception ${e}`);
            throw e;
        }
    };

    const onPopupDone = (v: string | undefined) => {
        if (typeof v === 'string') {
            onValueChanged(v);
        }
    };

    const valueStr = () => {
        return value >= 0 ? hexValuesLookup[(value >>> 0) & 0xff] : '~~';
    };

    const editable = () => {
        return !frozen && !myGlobals.isReadonly;
    };

    /*
  return (
    <div className={classNames()}>
      <span style={{ border: "1px" }} onClick={editable() ? handleClick : undefined}>{valueStr()}</span>
    </div>
  );
  */
    return (
        <span
            tabIndex={0}
            className={classNames()}
            style={{ border: '1px' }}
            onClick={editable() ? handleClick : undefined}
        >
            {valueStr()}
        </span>
    );
}

export const HexCellAddress: React.FC<{ address: bigint }> = ({ address }) => {
    const classNames = 'hex-cell hex-cell-address';
    // const id = `hex-cell-address-${address}`;
    const valueStr = address.toString(16).padStart(16, '0').padEnd(18, ' ');
    return <span className={classNames}>{valueStr}</span>;
};

export const HexCellChar: React.FunctionComponent<{
    address: bigint;
    byteOffset: number;
}> = ({ address, byteOffset }) => {
    // const id = `hex-cell-char-${address}`
    const inRange = addrInRange(address, byteOffset);
    const val = inRange ? (myGlobals.bytes[byteOffset] >>> 0) & 0xff : -1;
    const origVal = inRange ? (myGlobals.origBytes[byteOffset] >>> 0) & 0xff : -1;
    const valueStr = val >= 0 ? charCodesLookup[val] : '~~';
    const classNames = 'hex-cell hex-cell-char' + (val !== origVal ? ' hex-cell-char-changed' : '');
    return <span className={classNames}>{valueStr}</span>;
};

export const HexCellEmpty: React.FunctionComponent<{
    length: number;
    fillChar?: string;
    cls?: string;
}> = ({ length = 1, fillChar = ' ', cls = '' }) => {
    const classNames = 'hex-cell ' + cls;
    const valueStr = fillChar.repeat(length);
    return <span className={classNames}>{valueStr}</span>;
};

export const HexCellEmptyHeader: React.FunctionComponent<{
    length?: number;
    fillChar?: string;
    cls?: string;
}> = ({ length = 1, fillChar = ' ', cls = '' }) => {
    const classNames = `hex-cell hex-cell-char-header ${cls}`;
    const valueStr = fillChar.repeat(length);
    return <span className={classNames}>{valueStr}</span>;
};

export const HexCellValueHeader: React.FunctionComponent<{
    value: number;
}> = ({ value }) => {
    const classNames = 'hex-cell hex-cell-value-header';
    // const id = `hex-cell-value-header-${value}`;
    const valueStr = hexValuesLookup[(value >>> 0) & 0xff];
    return <span className={classNames}>{valueStr}</span>;
};

interface IHexHeaderRow {
    address: bigint;
}

export function HexHeaderRow(props: IHexHeaderRow): JSX.Element {
    const classNames = 'hex-header-row';
    const ary = [];
    // let lowByte = Number(props.address % 16n);
    let lowByte = Number(BigInt.asUintN(8, props.address));
    for (let x = 0; x < 16; x++, lowByte++) {
        ary.push(lowByte & 0xff);
    }
    const decodedText = 'Decoded Bytes'.padEnd(16, ' ').split('');
    return (
        <div className={classNames}>
            <HexCellEmptyHeader
                key={1}
                length={18}
                fillChar='.'
                cls='hex-cell-address hex-cell-invisible'
            />
            {ary.map((v, i) => {
                return <HexCellValueHeader key={i + 2} value={v} />;
            })}
            <HexCellEmpty key={100} length={1} fillChar='.' cls='hex-cell-invisible' />
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
    onChange?: OnCellChangeFunc;
}

interface IHexDataRowState {
    counter: number;
}

export class HexDataRow extends React.Component<IHexDataRow, IHexDataRowState> {
    constructor(public props: IHexDataRow) {
        super(props);
        this.state = { counter: 0 };
    }

    private rowChanged(address: bigint, byteOffset: number, newVal: number) {
        this.setState({ counter: this.state.counter + 1 }); // Force an update
        if (this.props.onChange) {
            this.props.onChange(address, byteOffset, newVal);
        }
    }

    render() {
        const classNames = 'hex-data-row';
        const values = [];
        const chars = [];
        for (let ix = 0; ix < 16; ix++) {
            const addr = this.props.address + BigInt(ix);
            const offset = this.props.byteOffset + ix;
            values.push(
                <HexCellValue
                    key={ix + 2}
                    address={addr}
                    byteOffset={offset}
                    dirty={this.props.dirty}
                    onChange={this.rowChanged.bind(this)}
                />
            );
            chars.push(<HexCellChar address={addr} byteOffset={offset} key={ix + 18} />);
        }
        const gap = <HexCellEmpty length={1} fillChar='.' cls='hex-cell-invisible'></HexCellEmpty>;
        return (
            <div className={classNames}>
                <HexCellAddress key={1} address={this.props.address} />
                <div>
                    {values}
                    {gap}
                    {chars}
                </div>
            </div>
        );
    }
}

export interface IHexTable {
    address: bigint; // Address of first byte ie. bytes[byteOffset];
    byteStart: number;
    numBytes: number;
    dirty: boolean;
    onChange?: OnCellChangeFunc;
}

export function HexTable(props: IHexTable): JSX.Element {
    const header = <HexHeaderRow key='h' address={props.address} />;
    const rows = [];
    let offset = props.byteStart;
    const startAddr = (props.address / 16n) * 16n;
    const endAddr = ((props.address + BigInt(props.numBytes + 15)) / 16n) * 16n;
    for (let addr = startAddr; addr < endAddr; addr += 16n, offset += 16) {
        rows.push(
            <HexDataRow
                key={offset}
                address={addr}
                byteOffset={offset}
                dirty={props.dirty}
                onChange={props.onChange}
            />
        );
    }

    const timer = new Utils.Timekeeper();
    const ret = (
        <div id='hex-grid' className='hex-grid'>
            {header}
            <div className='hex-data-rows'>{rows}</div>
            <PopupHexCellEdit {...PopupHexCellEdit.globalProps}></PopupHexCellEdit>
        </div>
    );
    console.log(`Top-level:render ${timer.deltaMs()}ms`);
    return ret;
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
    value: string;
}
// This is a modification of what I found here
// https://jasonwatmore.com/post/2018/01/23/react-custom-modal-window-dialog-box
export class PopupHexCellEdit extends React.PureComponent<IHexCellEditProps, IHexCellEditState> {
    static globalModel: PopupHexCellEdit | undefined;
    static globalProps: IHexCellEditProps = {
        // Can also be used as defaultProps
        trigger: false,
        clientX: 0,
        clientY: 0,
        value: '',
        callback: function (_value: string | undefined): void {
            throw new Error('Function not implemented.');
        }
    };
    private static onKeyDownFunc: any;
    private static inputElementId = 'PopupHexCellEdit.input';
    private handleClickFunc: any;
    private onChangeFunc: any;
    private lastGoodValue = '';
    private textInput: React.RefObject<HTMLInputElement>;

    static open(e: any, props: IHexCellEditProps) {
        e && e.preventDefault();
        if (PopupHexCellEdit.globalModel) {
            Object.assign(PopupHexCellEdit.globalProps, props);
            PopupHexCellEdit.globalModel.lastGoodValue = props.value;
            PopupHexCellEdit.globalModel.setState({
                isOpen: true,
                value: props.value
            });
            setTimeout(() => {
                // const elt = document.getElementById(PopupHexCellEdit.inputElementId) as HTMLInputElement;
                let elt = PopupHexCellEdit.globalModel?.textInput?.current;
                if (!elt) {
                    console.error('Could not find textInput ref');
                    elt = document.getElementById(
                        PopupHexCellEdit.inputElementId
                    ) as HTMLInputElement;
                }
                if (elt) {
                    elt.focus();
                    elt.select();
                } else {
                    console.error('Could not find textInput in document either');
                }
            }, 10);
            document.addEventListener('keydown', PopupHexCellEdit.onKeyDownFunc, false);
        } else {
            throw new Error('PopupHexCellEdit: no global model defined before calling open');
        }
    }

    static close(e: any) {
        e && e.preventDefault();
        if (PopupHexCellEdit.globalModel) {
            PopupHexCellEdit.globalModel.setState({ isOpen: false });
            document.removeEventListener('keydown', PopupHexCellEdit.onKeyDownFunc, false);
        } else {
            throw new Error('PopupHexCellEdit: no global model defined when calling close');
        }
    }

    constructor(props: IHexCellEditProps) {
        super(props);
        if (PopupHexCellEdit.globalModel) {
            throw new Error(
                'IHexCellEditProps is a singleton. Cannot call this multiple times without unmounting first'
            );
        }
        Object.assign(PopupHexCellEdit.globalProps, props);
        this.textInput = React.createRef<HTMLInputElement>();
        this.state = { isOpen: false, value: '' };
        this.handleClickFunc = this.handleClick.bind(this);
        this.onChangeFunc = this.onChange.bind(this);
        PopupHexCellEdit.onKeyDownFunc = this.onKeyDown.bind(this);
    }

    componentDidMount() {
        // We are now ready for open/close
        PopupHexCellEdit.globalModel = this;
    }

    componentWillUnmount() {
        // We probably need to invalidate a bunch of other globals
        PopupHexCellEdit.globalModel = undefined;
    }

    handleClick(e: any) {
        // close modal on background click
        if (e.target.className === 'popup-background') {
            PopupHexCellEdit.globalProps.callback(undefined);
            PopupHexCellEdit.close(e);
        }
    }

    private onChange(event: any) {
        const v = event.target.value.trim();
        this.setState({ value: v });
        if (!/^[0-9a-fA-f]{0,2}$/.test(v)) {
            // The pattern on the input element does not work because it is not in a form
            // Onm case, it doesn't we do our own. We do our own in the keyDown event but
            // something may still geth through
            event.target.value = this.lastGoodValue;
        } else {
            this.lastGoodValue = v;
        }
        if (v !== event.target.value) {
            // TODO: do this differently to check for valid input. invalid chars should never
            // even be allowed
            setTimeout(() => {
                event.target.value = this.lastGoodValue;
            }, 50);
        }
    }

    public onKeyDown(event: any) {
        let v: string | undefined = undefined;
        if (event.key === 'Enter') {
            v = this.lastGoodValue;
        } else if (event.key !== 'Escape') {
            if (event.key.length === 1 && !/[0-9a-fA-f]/.test(event.key)) {
                event.preventDefault();
            }
            return;
        }
        PopupHexCellEdit.globalProps.callback(v);
        PopupHexCellEdit.close(event);
    }

    render() {
        return (
            <div
                className='PopupHexCellEdit'
                style={{ display: +this.state.isOpen ? '' : 'none' }}
                onClick={this.handleClickFunc}
            >
                <div
                    className='popup'
                    style={{
                        top: PopupHexCellEdit.globalProps.clientY,
                        left: PopupHexCellEdit.globalProps.clientX
                    }}
                >
                    <input
                        id={PopupHexCellEdit.inputElementId}
                        ref={this.textInput}
                        autoFocus
                        type='text'
                        maxLength={2}
                        style={{ width: '4ch' }}
                        pattern='[0-9a-fA-F]{1,2}' /* does not work */
                        value={this.state.value}
                        onChange={this.onChangeFunc}
                    ></input>
                </div>
                <div className='popup-background'></div>
            </div>
        );
    }
}

const odStyleChars = [
    'nul',
    'soh',
    'stx',
    'etx',
    'eot',
    'enq',
    'ack',
    'bel',
    'bs',
    'ht',
    'nl',
    'vt',
    'ff',
    'cr',
    'so',
    'si',
    'dle',
    'dc1',
    'dc2',
    'dc3',
    'dc4',
    'nak',
    'syn',
    'etb',
    'can',
    'em',
    'sub',
    'esc',
    'fs',
    'gs',
    'rs',
    'us',
    'sp'
];

const charCodesLookup: string[] = [];
const hexValuesLookup: string[] = [];
for (let byte = 0; byte <= 255; byte++) {
    const v =
        byte <= 32
            ? odStyleChars[byte]
            : byte === 127
            ? 'del'
            : byte > 127 && byte <= 159
            ? '.'
            : String.fromCharCode(byte);
    charCodesLookup.push(v);
    hexValuesLookup.push(byte.toString(16).padStart(2, '0'));
}

function addrInRange(addr: bigint, byteOffset: number): boolean {
    // TODO: handle unsigned bigint case. Not sure if the high bit is set
    if (byteOffset >= myGlobals.bytes?.length) {
        return false;
    }
    if (addr < myGlobals.minAddress) {
        return false;
    }
    if (myGlobals.maxAddress !== undefined && addr > myGlobals.maxAddress) {
        return false;
    }
    return true;
}

/*
function bigIntMax(a: bigint, b: bigint) {
  return a > b ? a : b;
}
function bigIntMin(a: bigint, b: bigint) {
  return a < b ? a : b;
}
*/
