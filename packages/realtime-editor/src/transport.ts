import { LAYOUT_MODES, SCROLL_MODES } from './constants';
import { seekToClientX } from './mobile';
import { dom, getActiveDocument, state } from './state';

export function setupTransport(): void {
    dom.playPauseButton.addEventListener('click', () => {
        state.api?.playPause();
    });

    dom.stopButton.addEventListener('click', () => {
        state.api?.stop();
    });

    dom.speedSelect.addEventListener('change', () => {
        if (state.api) {
            state.api.playbackSpeed = Number.parseFloat(dom.speedSelect.value);
        }
    });

    dom.zoomSelect.addEventListener('change', () => {
        if (!state.api) {
            return;
        }

        state.api.settings.display.scale = Number.parseInt(dom.zoomSelect.value, 10) / 100;
        state.api.updateSettings();
        state.api.render();
    });

    dom.layoutSelect.addEventListener('change', () => {
        if (!state.api) {
            return;
        }

        state.api.settings.display.layoutMode =
            LAYOUT_MODES[dom.layoutSelect.value as keyof typeof LAYOUT_MODES];
        state.api.updateSettings();
        state.api.render();
    });

    dom.scrollSelect.addEventListener('change', () => {
        if (!state.api) {
            return;
        }

        state.api.settings.player.scrollMode =
            SCROLL_MODES[dom.scrollSelect.value as keyof typeof SCROLL_MODES];
        state.api.updateSettings();
        state.api.render();
    });

    dom.timeline.addEventListener('click', event => {
        seekToClientX(event.clientX);
    });

    dom.timeline.addEventListener('keydown', event => {
        const timeInfo = getActiveDocument()?.currentTimeInfo;
        if (!timeInfo || !state.api) {
            return;
        }

        const step = Math.max(1_000, Math.floor(timeInfo.endTime * 0.02));
        switch (event.key) {
            case 'ArrowLeft':
                event.preventDefault();
                state.api.timePosition = Math.max(0, state.api.timePosition - step);
                break;
            case 'ArrowRight':
                event.preventDefault();
                state.api.timePosition = Math.min(timeInfo.endTime, state.api.timePosition + step);
                break;
        }
    });
}
