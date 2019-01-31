import BasePlugin from '../../plugins/_base';
import { registerPlugin } from '../../plugins';
import LooseBindsMap from './maps/looseBindsMap';
import StrictBindsMap from './maps/strictBindsMap';

const DEFAULT_BIND = 'loose';

const bindTypeToMapStrategy = new Map([
  ['loose', LooseBindsMap],
  ['strict', StrictBindsMap]
]);

/**
 * @plugin BindRowsWithHeaders
 *
 * @description
 * Plugin allows binding the table rows with their headers.
 *
 * If the plugin is enabled, the table row headers will "stick" to the rows, when they are hidden/moved. Basically, if
 * at the initialization row 0 has a header titled "A", it will have it no matter what you do with the table.
 *
 * @example
 * ```js
 * const container = document.getElementById('example');
 * const hot = new Handsontable(container, {
 *   date: getData(),
 *   // enable plugin
 *   bindRowsWithHeaders: true
 * });
 * ```
 */
class BindRowsWithHeaders extends BasePlugin {
  constructor(hotInstance) {
    super(hotInstance);
    /**
     * Plugin indexes cache.
     *
     * @private
     * @type {null|IndexMap}
     */
    this.headerIndexes = null;
  }

  /**
   * Checks if the plugin is enabled in the handsontable settings. This method is executed in {@link Hooks#beforeInit}
   * hook and if it returns `true` than the {@link BindRowsWithHeaders#enablePlugin} method is called.
   *
   * @returns {Boolean}
   */
  isEnabled() {
    return !!this.hot.getSettings().bindRowsWithHeaders;
  }

  /**
   * Enables the plugin functionality for this Handsontable instance.
   */
  enablePlugin() {
    if (this.enabled) {
      return;
    }

    let bindType = this.hot.getSettings().bindRowsWithHeaders;

    if (typeof bindType !== 'string') {
      bindType = DEFAULT_BIND;
    }

    const MapStrategy = bindTypeToMapStrategy.get(bindType);

    this.headerIndexes = this.hot.rowIndexMapper.registerMap('bindRowsWithHeaders', new MapStrategy());

    this.addHook('modifyRowHeader', row => this.onModifyRowHeader(row));

    super.enablePlugin();
  }

  /**
   * Disables the plugin functionality for this Handsontable instance.
   */
  disablePlugin() {
    this.hot.rowIndexMapper.unregisterMap('bindRowsWithHeaders');

    super.disablePlugin();
  }

  /**
   * On modify row header listener.
   *
   * @private
   * @param {Number} row Row index.
   * @returns {Number}
   */
  onModifyRowHeader(row) {
<<<<<<< HEAD
    return this.headerIndexes.getValueAtIndex(this.hot.toPhysicalRow(row));
=======
    return this.bindStrategy.translate(this.hot.toPhysicalRow(row));
  }

  /**
   * On after create row listener.
   *
   * @private
   * @param {Number} index Row index.
   * @param {Number} amount Defines how many rows removed.
   */
  onAfterCreateRow(index, amount) {
    this.bindStrategy.createRow(index, amount);
  }

  /**
   * On before remove row listener.
   *
   * @private
   * @param {Number} index Row index.
   * @param {Number} amount Defines how many rows removed.
   *
   * @fires Hooks#modifyRow
   */
  onBeforeRemoveRow(index, amount) {
    this.removedRows.length = 0;

    if (index !== false) {
      // Collect physical row index.
      rangeEach(index, index + amount - 1, (removedIndex) => {
        this.removedRows.push(this.hot.toPhysicalRow(removedIndex));
      });
    }
  }

  /**
   * On after remove row listener.
   *
   * @private
   */
  onAfterRemoveRow() {
    this.bindStrategy.removeRow(this.removedRows);
  }

  /**
   * On after load data listener.
   *
   * @private
   * @param {Boolean} firstRun Indicates if hook was fired while Handsontable initialization.
   */
  onAfterLoadData(firstRun) {
    if (!firstRun) {
      this.bindStrategy.createMap(this.hot.countSourceRows());
    }
>>>>>>> WIP: Changed all modify / unmodify hooks calls #5751
  }

  /**
   * Destroys the plugin instance.
   */
  destroy() {
    this.hot.rowIndexMapper.unregisterMap('bindRowsWithHeaders');

    super.destroy();
  }
}

registerPlugin('bindRowsWithHeaders', BindRowsWithHeaders);

export default BindRowsWithHeaders;
