import { DualViewDoc } from './dual-view-doc';
import { ITrackedDebugSessionXfer } from './shared';

export class WebviewDebugTracker {
    static currentSessions: ITrackedDebugSessionXfer[] = [];
    static sessionsById: { [key: string]: ITrackedDebugSessionXfer } = {};
    static sessionsByName: { [key: string]: ITrackedDebugSessionXfer } = {};

    static updateSessions(sessions: ITrackedDebugSessionXfer[]) {
        WebviewDebugTracker.currentSessions = [...sessions];
        for (const session of sessions) {
            WebviewDebugTracker.sessionsById[session.sessionId] = session;
            WebviewDebugTracker.sessionsByName[session.sessionName] = session;
            DualViewDoc.debuggerStatusChanged(session.sessionId, session.status, session.sessionName, session.wsFolder);
        }
    }

    static updateSession(arg: ITrackedDebugSessionXfer) {
        const id = arg.sessionId;
        DualViewDoc.debuggerStatusChanged(id, arg.status, arg.sessionName, arg.wsFolder);
        if (arg.status === 'terminated') {
            delete WebviewDebugTracker.sessionsById[id];
            delete WebviewDebugTracker.sessionsByName[arg.sessionName];
            WebviewDebugTracker.currentSessions = WebviewDebugTracker.currentSessions.filter((s) => s.sessionId !== id);
        } else if (WebviewDebugTracker.sessionsById[id]) {
            WebviewDebugTracker.sessionsById[id].status = arg.status;
        }
    }
}
