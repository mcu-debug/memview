/* eslint-disable @typescript-eslint/naming-convention */
import * as React from 'react';
import /* frozenState */ './webview-globals';
import /*
    RecoilRoot,
    atom,
    selector,
    useRecoilState,
    useRecoilValue,
    useSetRecoilState
    */
'recoil';
import { DualViewDoc, DummyByte, IDualViewDocGlobalEventArg } from './dual-view-doc';
import { IMemValue, UnknownDocId } from './shared';
import { hexFmt64, hexFmt64 as _hexFmt64 } from './utils';
import { SelContext } from './selection';

export type OnCellChangeFunc = (address: bigint, val: number) => void;
export type OnSelChangedFunc = (address: bigint) => void;
export type CellInfoType = IMemValue | IMemValue16or32or64;

interface IMemValue16or32or64 {
    cur: bigint;
    orig: bigint;
    changed: boolean;
    stale: boolean;
    invalid: boolean;
}
interface IHexCell {
    bytesPerCell: number;
    address: bigint;
    cellInfo: CellInfoType;
    onChange?: OnCellChangeFunc;
}

interface IHexCellState {
    frozen: boolean;
}
export class HexCellValue extends React.Component<IHexCell, IHexCellState> {
    private static currentDOMElt: HTMLSpanElement | undefined = undefined; // createRef not working on span element
    private static lastOrigValue = '';
    private static lastGoodValue = '';
    private static newGoodValue = '';
    private static maxChars = 2;

    constructor(public props: IHexCell) {
        super(props);
        /*
        const [frozen] = useRecoilState<boolean>(frozenState);
        */
        this.state = {
            frozen: false
        };
        HexCellValue.maxChars = this.props.bytesPerCell * 2;
    }

    classNames = () => {
        const byteInfo = this.props.cellInfo;
        const changed = byteInfo.orig !== byteInfo.cur || byteInfo.changed;
        return (
            `hex-cell hex-cell-value hex-cell-value${this.props.bytesPerCell}` +
            (this.state.frozen ? ' hex-cell-value-dirty' : '') +
            (changed ? ' hex-cell-value-changed' : '') +
            (SelContext.isSelected(this.props.address) ? ' selected-cell' : '')
        );
    };

    onValueChanged = (val: string) => {
        val = val.trim().toLowerCase();
        while (val.startsWith('0x')) {
            val = val.substring(2);
        }
        while (val.length > HexCellValue.maxChars && val.startsWith('0')) {
            val = val.substring(1);
        }
        if (val.length > HexCellValue.maxChars || val.length === 0 || /[^0-9a-f]]/.test(val)) {
            return;
        }

        // TODO: adjust for byte-length
        const intVal = parseInt(val, 16);
        if (this.props.cellInfo.cur !== intVal) {
            this.props.cellInfo.cur = intVal;
            DualViewDoc.setCurrentDocByte(this.props.address, intVal);
            if (this.props.onChange) {
                this.props.onChange(this.props.address, intVal);
            }
        }
    };

    valueStr = () => {
        return HexCellValue.formatValue(this.props.bytesPerCell === 1, this.props.cellInfo);
    };

    public static formatValue(isByte: boolean, cellInfo: CellInfoType): string {
        if (isByte) {
            return cellInfo.cur >= 0 ? hexValuesLookup[((cellInfo as IMemValue).cur >>> 0) & 0xff] : '~~';
        } else {
            const info = cellInfo as IMemValue16or32or64;
            const value = info.cur;
            const str = info.invalid
                ? '~'.padStart(this.maxChars, '~')
                : value.toString(16).padStart(this.maxChars, '0');
            return str;
        }
    }

    editable = () => {
        return !this.state.frozen && !DualViewDoc.currentDoc?.isReadonly;
    };

    static dbgPrints = false;
    private static printJunk(label: string) {
        if (HexCellValue.dbgPrints) {
            console.log(
                label,
                'lastOrigValue',
                HexCellValue.lastOrigValue,
                'lastGoodValue',
                HexCellValue.lastGoodValue,
                'newGoodValue',
                HexCellValue.newGoodValue
            );
        }
    }

    public onKeyDown(event: any) {
        if (!this.editable()) {
            event.preventDefault();
            return;
        }
        HexCellValue.printJunk('onKeyDown');
        let v: string = HexCellValue.lastGoodValue;
        if (event.key === 'Enter' || event.key === 'Tab') {
            if (v === '') {
                HexCellValue.revertEditsInDOM(HexCellValue.currentDOMElt, this.valueStr());
                return;
            }
            v = HexCellValue.lastGoodValue;
        } else if (event.key !== 'Escape') {
            if (event.key.length === 1) {
                if (!/[0-9a-fA-f]/.test(event.key)) {
                    event.preventDefault();
                }
            }
            return;
        } else {
            HexCellValue.revertEditsInDOM(HexCellValue.currentDOMElt, this.valueStr());
            return;
        }
        if (v) {
            HexCellValue.newGoodValue = v;
            if (HexCellValue.lastOrigValue !== v) {
                setTimeout(() => {
                    this.onValueChanged(v);
                }, 1);
            }
        }
    }
    private onKeyDownFunc = this.onKeyDown.bind(this);

    private static revertEditsInDOM(cell: HTMLSpanElement | undefined, val: string) {
        if (cell) {
            setTimeout(() => {
                cell.innerText = val;
            }, 1);
        }
    }

    private onInput(ev: any) {
        if (!this.editable()) {
            return;
        }
        // console.log('onInput: new value = ' + ev.currentTarget.innerText);
        if (ev.currentTarget.innerText.length > 2) {
            const el = ev.currentTarget;
            const val = HexCellValue.lastGoodValue;
            setTimeout(() => {
                el.innerText = val;
            }, 1);
        } else {
            HexCellValue.lastGoodValue = ev.currentTarget.innerText;
        }
    }
    private onInputFunc = this.onInput.bind(this);
    private onFocus(ev: any) {
        HexCellValue.dbgPrints && console.log(`onFocus: new = ${ev.currentTarget.innerText}, old = ${this.valueStr()}`);
        if (ev.currentTarget && this.editable()) {
            // console.log(`onFocus: new = ${ev.currentTarget.innerText}, old = ${this.valueStr()}`);
            HexCellValue.currentDOMElt = ev.currentTarget;
            try {
                HexCellValue.selectItem(ev.currentTarget);
            } catch {
                console.error('HexCellValue.selectItem failed');
            }
            document.addEventListener('keydown', this.onKeyDownFunc, false);
        }
        HexCellValue.lastGoodValue = this.valueStr();
        HexCellValue.lastOrigValue = HexCellValue.lastGoodValue;
        HexCellValue.newGoodValue = '';
        HexCellValue.printJunk('onFocus');
    }
    private onFocusFunc = this.onFocus.bind(this);
    private onBlur(ev: any) {
        HexCellValue.dbgPrints && console.log(`onBlur: new = ${ev.currentTarget.innerText}`);
        if (ev.currentTarget && this.editable()) {
            // console.log('onBlur: ' + ev.currentTarget.innerText);
            document.removeEventListener('keydown', this.onKeyDownFunc, false);
            HexCellValue.revertEditsInDOM(HexCellValue.currentDOMElt, HexCellValue.newGoodValue || this.valueStr());
        }
        HexCellValue.currentDOMElt = undefined;
        HexCellValue.lastOrigValue = '';
        HexCellValue.lastGoodValue = '';
        HexCellValue.newGoodValue = '';
        HexCellValue.printJunk('onBlur');
    }
    private onBlurFunc = this.onBlur.bind(this);

    static selectItem(item: any) {
        return; // Following is bogus
        let range, selection: any;
        if (window.getSelection && document.createRange) {
            selection = window.getSelection();
            range = document.createRange();
            range.selectNodeContents(item);
            selection.removeAllRanges();
            selection.addRange(range);
        } else if ((document as any).selection && (document.body as any).createTextRange) {
            range = (document.body as any).createTextRange();
            range.moveToElementText(this);
            range.select();
        }
    }

    private onMouseDownFunc = this.onMouseDown.bind(this);
    private onMouseDown(e: React.MouseEvent) {
        if (e.buttons & 1) {
            if (!e.shiftKey) {
                SelContext.current?.clear();
            }
            SelContext.current?.setCurrent(this.props.address, e.target as Element);
        }
    }

    render() {
        return (
            <span
                tabIndex={0}
                suppressContentEditableWarning={true}
                contentEditable={true}
                className={this.classNames()}
                onFocus={this.onFocusFunc}
                onBlur={this.onBlurFunc}
                onInput={this.onInputFunc}
                onMouseDown={this.onMouseDownFunc}
            >
                {this.valueStr()}
            </span>
        );
    }
}

export const HexCellAddress: React.FC<{ address: bigint; cls?: string }> = ({ address, cls }) => {
    const classNames = 'hex-cell hex-cell-address ' + cls;
    // const id = `hex-cell-address-${address}`;
    const valueStr = address.toString(16).padStart(16, '0').padEnd(18, ' ');
    return <span className={classNames}>{valueStr}</span>;
};

export const HexCellChar: React.FunctionComponent<{
    address: bigint;
    byteInfo: IMemValue;
}> = ({ address, byteInfo }) => {
    const val = byteInfo.cur;
    const origVal = byteInfo.orig;
    const valueStr = val >= 0 ? charCodesLookup[val] : '~~';
    let classNames = 'hex-cell hex-cell-char' + (val !== origVal || byteInfo.changed ? ' hex-cell-char-changed' : '');
    if (SelContext.isSelected(address)) {
        classNames += ' selected-char';
    }
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
    bytesPerCell: number;
}> = ({ value, bytesPerCell }) => {
    const classNames = `hex-cell hex-cell-value-header hex-cell-value-header${bytesPerCell} `;
    let valueStr = hexValuesLookup[(value >>> 0) & 0xff];
    if (bytesPerCell !== 1) {
        if (DualViewDoc.currentDoc?.endian === 'big') {
            valueStr = valueStr + '-' + hexValuesLookup[((value + bytesPerCell - 1) >>> 0) & 0xff];
        } else {
            valueStr = hexValuesLookup[((value + bytesPerCell - 1) >>> 0) & 0xff] + '-' + valueStr;
        }
    }
    return <span className={classNames}>{valueStr}</span>;
};

export interface IHexHeaderRow {
    style?: any;
    cls?: string;
}

export function HexHeaderRow(props: IHexHeaderRow): JSX.Element {
    const fmt = DualViewDoc.currentDoc?.format;
    const bytesPerCell = fmt === '1-byte' ? 1 : fmt === '2-byte' ? 2 : fmt === '4-byte' ? 4 : 8;
    const classNames = `hex-header-row scrollHorizontalSync ${props.cls || ''}`;
    const addrCells: JSX.Element[] = [];
    const bytesInRow = bytesPerCell === 1 ? 16 : 32;

    let key = 2;
    for (let ix = 0; ix < bytesInRow; ix += bytesPerCell) {
        addrCells.push(<HexCellValueHeader key={key++} value={ix % bytesInRow} bytesPerCell={bytesPerCell} />);
    }
    const decodedTextCells: JSX.Element[] = [];
    if (bytesPerCell === 1) {
        const tmp = 'Decoded Bytes'.padEnd(16, ' ');
        let decodedText = '';
        for (let ix = 0; ix < bytesInRow; ix += 16) {
            decodedText += tmp;
        }
        const asList = decodedText.split('');
        for (let ix = 0; ix < bytesInRow; ix++) {
            const v = asList[ix];
            decodedTextCells.push(<HexCellEmptyHeader key={key++} fillChar={v} />);
        }
    }
    return (
        <div className={classNames} style={props.style || {}}>
            <HexCellAddress key={100} cls='header-cell-address' address={DualViewDoc.currentDoc?.startAddress ?? 0n} />
            {addrCells}
            <HexCellEmpty key={101} length={1} fillChar='.' cls='hex-cell-invisible' />
            {decodedTextCells}
        </div>
    );
}

export interface IHexDataRow {
    address: bigint;
    onChange?: OnCellChangeFunc;
    style?: any;
    cls?: string;
}

interface IHexDataRowState {
    bytes: IMemValue[];
    words: IMemValue16or32or64[];
}

export class HexDataRow extends React.Component<IHexDataRow, IHexDataRowState> {
    private docId = UnknownDocId;
    private sessionId = UnknownDocId;
    private sessionStatus = UnknownDocId;
    private onRowChangeFunc = this.rowChanged.bind(this);
    private mountStatus = false;
    private bytesInRow = 16;
    private static bytePerWord: 1 | 2 | 4 | 8;
    private static byteOrder: number[] = [];
    private static isBigEndian = false;
    private myRef = React.createRef<HTMLDivElement>();
    constructor(public props: IHexDataRow) {
        super(props);
        const fmt = DualViewDoc.currentDoc?.format;
        if (HexDataRow.byteOrder.length === 0) {
            HexDataRow.bytePerWord = fmt === '1-byte' ? 1 : fmt === '2-byte' ? 2 : fmt === '4-byte' ? 4 : 8;
            HexDataRow.isBigEndian = DualViewDoc.currentDoc?.endian === 'big';
            if (HexDataRow.isBigEndian) {
                for (let ix = 0; ix < HexDataRow.bytePerWord; ix++) {
                    HexDataRow.byteOrder.push(ix);
                }
            } else {
                for (let ix = HexDataRow.bytePerWord - 1; ix >= 0; ix--) {
                    HexDataRow.byteOrder.push(ix);
                }
            }
        }
        this.bytesInRow = HexDataRow.bytePerWord === 1 ? 16 : 32;
        const bytes = [];
        for (let ix = 0; ix < this.bytesInRow; ix++) {
            bytes[ix] = DummyByte;
        }
        this.state = {
            bytes: bytes,
            words: this.convertToWords(bytes)
        };
    }

    private convertToWords(bytes: IMemValue[]): IMemValue16or32or64[] {
        const ret: IMemValue16or32or64[] = [];
        if (HexDataRow.bytePerWord === 1) {
            return ret;
        }
        const len = HexDataRow.bytePerWord;
        for (let start = 0; start < this.bytesInRow; start += len) {
            let curV = 0n;
            let origV = 0n;
            let invalid = false;
            let changed: boolean | undefined = false;
            let stale: boolean | undefined = false;
            try {
                for (const ix of HexDataRow.byteOrder) {
                    const byte = bytes[start + ix];
                    if (byte.cur < 0) {
                        invalid = true;
                        break;
                    }
                    changed = changed || byte.changed;
                    stale = stale || byte.stale;
                    if (HexDataRow.isBigEndian) {
                        curV = (curV << 8n) | BigInt(byte.cur & 0xff);
                        origV = (origV << 8n) | BigInt(byte.orig & 0xff);
                    } else {
                        curV = (curV << 8n) | BigInt(byte.cur & 0xff);
                        origV = (origV << 8n) | BigInt(byte.orig & 0xff);
                    }
                }
            } catch (e) {
                console.log(e);
            }
            ret.push({
                cur: curV,
                orig: origV,
                changed: !!changed,
                stale: !!changed,
                invalid: invalid
            });
        }
        return ret;
    }

    private async rowChanged(address: bigint, newVal: number) {
        await this.getBytes();
        if (this.props.onChange) {
            this.props.onChange(address, newVal);
        }
    }

    private async getBytes() {
        if (this.mountStatus) {
            // Since we are async, we can get unmounted while we wait
            // Get the first byte of the row. The rest should be in the same page
            // so do it the fast way, since the bytes should have been loaded by now
            let bytes: IMemValue[] = [];
            const p = [];
            for (let row = 0; row < this.bytesInRow / 16; row++) {
                const addr = this.props.address + BigInt(16 * row);
                p.push(DualViewDoc.getCurrentDocByte(addr));
            }
            await Promise.all(p);
            for (let row = 0; row < this.bytesInRow / 16; row++) {
                const addr = this.props.address + BigInt(16 * row);
                bytes = bytes.concat(DualViewDoc.getRowUnsafe(addr));
            }
            const words = this.convertToWords(bytes);
            this.setState({ bytes: bytes, words: words });
        }
    }

    public getRowValues(): CellInfoType[] {
        return HexDataRow.bytePerWord === 1 ? this.state.bytes : this.state.words;
    }

    async componentDidMount() {
        DualViewDoc.globalEventEmitter.addListener('any', this.onGlobalEventFunc);
        this.mountStatus = true;
        await this.getBytes();
    }

    componentWillUnmount() {
        if (this.mountStatus) {
            DualViewDoc.globalEventEmitter.removeListener('any', this.onGlobalEventFunc);
            // console.log(`In HexDataRow.componentWillUnmount() ${this.props.address}`);
            this.mountStatus = false;
        }
    }

    private onGlobalEventFunc = this.onGlobalEvent.bind(this);
    private onGlobalEvent(arg: IDualViewDocGlobalEventArg) {
        // console.log(`In HexDataRow.onGlobalEvent() ${_hexFmt64(this.props.address)}`);
        let modified = false;
        if (arg.sessionId !== this.sessionId) {
            this.sessionId = arg.sessionId || this.sessionId;
            modified = true;
        }
        if (arg.docId !== this.docId) {
            this.docId = arg.docId || this.docId;
            modified = true;
        }
        if (arg.sessionStatus !== this.sessionStatus) {
            this.sessionStatus = arg.sessionStatus || this.sessionStatus;
            modified = true;
        }
        if (modified) {
            this.getBytes(); // TODO: Is this safe to do right now? SHould we wait? how?
        }
    }

    render() {
        const addrStr = hexFmt64(this.props.address);
        // console.log(`In HexDataRow.render() ${addrStr}`);
        const classNames = `hex-data-row r${addrStr} ` + (this.props.cls || '');
        const values = [];
        const chars = [];
        let key = 1;
        for (let ix = 0; ix < this.bytesInRow / HexDataRow.bytePerWord; ix++) {
            const addr = this.props.address + BigInt(ix * HexDataRow.bytePerWord);
            values.push(
                <HexCellValue
                    bytesPerCell={HexDataRow.bytePerWord}
                    key={key++}
                    address={addr}
                    cellInfo={HexDataRow.bytePerWord === 1 ? this.state.bytes[ix] : this.state.words[ix]}
                    onChange={this.onRowChangeFunc}
                />
            );
            if (HexDataRow.bytePerWord === 1) {
                chars.push(<HexCellChar address={addr} byteInfo={this.state.bytes[ix]} key={key++} />);
            }
        }
        return (
            <div className={classNames} style={this.props.style || ''} ref={this.myRef}>
                <HexCellAddress key={100} address={this.props.address} />
                {values}
                <HexCellEmpty key={101} length={1} fillChar='.' cls='hex-cell-invisible' />
                {chars}
            </div>
        );
    }
}
export interface IHexCellEditProps {
    trigger: boolean;
    clientX: number;
    clientY: number;
    value: string;
    callback: (value: string | undefined) => void;
}
export interface IHexCellEditState {
    isOpen: boolean;
    value: string;
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
        byte < 32
            ? odStyleChars[byte]
            : byte === 127
            ? 'del'
            : byte > 127 && byte <= 159
            ? '.'
            : String.fromCharCode(byte);
    charCodesLookup.push(v);
    hexValuesLookup.push(byte.toString(16).padStart(2, '0'));
}

/*
function bigIntMax(a: bigint, b: bigint) {
  return a > b ? a : b;
}
function bigIntMin(a: bigint, b: bigint) {
  return a < b ? a : b;
}
*/
