import * as React from 'react';
import { IHexCellEditProps, IHexCellEditState } from './hex-elements';

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
