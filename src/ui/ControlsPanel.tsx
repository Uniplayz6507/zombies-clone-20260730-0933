import './MainMenu.css';

interface Props {
  onClose: () => void;
}

/** Static help sheet. Also reachable mid-run from the pause overlay. */
export default function ControlsPanel({ onClose }: Props) {
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Controls and help">
      <div className="sheet__box">
        <p className="kicker">Field manual</p>
        <h2>Controls &amp; Survival</h2>

        <div className="sheet__grid">
          <div>
            <h3>Movement</h3>
            <ul className="sheet__list">
              <li>
                <span>
                  <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>
                </span>
                <span>Move</span>
              </li>
              <li>
                <span>
                  <kbd>Shift</kbd>
                </span>
                <span>Sprint (drains stamina)</span>
              </li>
              <li>
                <span>
                  <kbd>Space</kbd>
                </span>
                <span>Jump</span>
              </li>
              <li>
                <span>
                  <kbd>Ctrl</kbd>
                </span>
                <span>Crouch</span>
              </li>
              <li>
                <span>Mouse</span>
                <span>Look</span>
              </li>
            </ul>
          </div>

          <div>
            <h3>Combat</h3>
            <ul className="sheet__list">
              <li>
                <span>Left click</span>
                <span>Fire</span>
              </li>
              <li>
                <span>Right click</span>
                <span>Aim down sights</span>
              </li>
              <li>
                <span>
                  <kbd>R</kbd>
                </span>
                <span>Reload</span>
              </li>
              <li>
                <span>
                  <kbd>V</kbd> / <kbd>F</kbd>
                </span>
                <span>Melee &mdash; Trench Fang</span>
              </li>
              <li>
                <span>
                  <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> / <kbd>Q</kbd>
                </span>
                <span>Switch weapon</span>
              </li>
            </ul>
          </div>

          <div>
            <h3>Interaction</h3>
            <ul className="sheet__list">
              <li>
                <span>
                  <kbd>E</kbd>
                </span>
                <span>Buy / open / hold to upgrade</span>
              </li>
              <li>
                <span>
                  <kbd>M</kbd>
                </span>
                <span>Mute audio</span>
              </li>
              <li>
                <span>
                  <kbd>Esc</kbd>
                </span>
                <span>Pause &amp; release cursor</span>
              </li>
              <li>
                <span>
                  <kbd>F3</kbd>
                </span>
                <span>Performance overlay</span>
              </li>
            </ul>
          </div>

          <div>
            <h3>How to survive</h3>
            <ul className="sheet__list">
              <li>
                <span>&rsaquo;</span>
                <span>Points come from damage and kills. Headshots pay double.</span>
              </li>
              <li>
                <span>&rsaquo;</span>
                <span>Spend at a Requisition Panel for a weapon or an ammo cache.</span>
              </li>
              <li>
                <span>&rsaquo;</span>
                <span>Shutters cost points and open new ground &mdash; and new spawns.</span>
              </li>
              <li>
                <span>&rsaquo;</span>
                <span>Keep moving. Standing still in a doorway is how runs end.</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="sheet__note">
          <strong>Chokepoints are the whole game.</strong> The Blighted path with local steering, so
          they crowd and clog in doorways instead of pathing perfectly around you. Train them into a
          line, then walk backwards down the street and cut through them.
        </div>

        <div className="menu__row" style={{ marginTop: 26 }}>
          <button className="btn" onClick={onClose} autoFocus>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
