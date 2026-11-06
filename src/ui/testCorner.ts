import type { GameAudio } from '../audio/gameAudio';
import { onSettingsChange, settings } from '../core/settings';
import type { FrontDoor } from './frontDoor';
import type { Panel } from './menu';

/** What the corner opens: the TEST sheet (ui/testMenu.ts). */
export interface TestSheet extends Panel {
  open(onClose: () => void, showFocus: boolean): void;
}

/**
 * TEST in the pause menu's corner while Settings → Test tools is on. The
 * sheet loads on the first tap (`load`), so its code isn't parsed at boot.
 */
export function mountTestCorner(frontDoor: FrontDoor, audio: GameAudio, load: () => Promise<TestSheet>, showFocus: () => boolean): void {
  const button = frontDoor.pause.addCorner('TEST', 'wrench', () => {
    audio.ui('click');
    load().then(
      (menu) => {
        // The pause menu may have gone while it loaded.
        if (!frontDoor.pauseMenuOpen) return;
        frontDoor.openPanel(menu);
        menu.open(() => frontDoor.closePanel(menu), showFocus());
      },
      () => {},
    );
  });
  const sync = () => (button.hidden = !settings.testTools);
  sync();
  onSettingsChange(sync);
}
