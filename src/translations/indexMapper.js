import { arrayFilter, arrayMap } from './../helpers/array';
import { getListWithRemovedItems, getListWithInsertedItems } from './maps/utils/visuallyIndexed';
import { rangeEach } from '../helpers/number';
import IndexToIndexMap from './maps/visualIndexToPhysicalIndexMap';
import SkipMap from './maps/skipMap';
import HiddenMap from './maps/hiddenMap';
import MapCollection from './mapCollection';
import localHooks from '../mixins/localHooks';
import { mixin } from '../helpers/object';
import { isDefined } from '../helpers/mixed';

/**
 * Index mapper manages the mappings provided by "smaller" maps called index map(s). Those maps provide links from
 * indexes (physical¹ or visual² depending on requirements) to another value. For example, we may link physical column
 * indexes with widths of columns. On every performed CRUD action such as insert column, move column and remove column
 * the value (column width) will stick to the proper index. The index mapper is used as the centralised source of truth
 * regarding row and column indexes (their sequence, information if they are skipped in the process of rendering,
 * values linked to them). It handles CRUD operations on indexes and translate the visual indexes to the physical
 * indexes and the other way round³. It has built in cache. Thus, this way, read operations are as fast as possible.
 * Cache updates are triggered only when the data or structure changes.
 *
 * ¹ Physical index is particular index from the sequence of indexes assigned to the data source rows / columns
 * (from 0 to n, where n is number of the cells on the axis).
 * ² Visual index is particular index from the sequence of indexes assigned to visible rows / columns
 * (from 0 to n, where n is number of the cells on the axis).
 * ³ It maps from visible row / column to its representation in the data source and the other way round.
 * For example, when we sorted data, our 1st visible row can represent 4th row from the original source data,
 * 2nd can be mapped to 3rd, 3rd to 2nd, etc. (keep in mind that indexes are represent from the zero).
 */
class IndexMapper {
  constructor() {
    /**
     * Map storing the sequence of indexes.
     *
     * @private
     * @type {VisualIndexToPhysicalIndexMap}
     */
    this.indexesSequence = new IndexToIndexMap();
    /**
     * Collection for different skip maps. Indexes marked as skipped in any map won't be placed in the dataset.
     *
     * @private
     * @type {MapCollection}
     */
    this.skipMapsCollection = new MapCollection();
    /**
     * Collection for different hide maps. Indexes marked as hidden in any map won't be rendered, 
     * but will exist in the dataset.
     *
     * @private
     * @type {MapCollection}
     */
    this.hiddenCollection = new MapCollection();
    /**
     * Collection for another kind of maps.
     *
     * @private
     * @type {MapCollection}
     */
    this.variousMapsCollection = new MapCollection();
    /**
     * Cache for skip result for particular indexes.
     *
     * @private
     * @type {Array}
     */
    this.flattenSkipList = [];
    /**
     * Cache for list of not skipped indexes, respecting the indexes sequence.
     *
     * @private
     * @type {Array}
     */
    this.notSkippedIndexesCache = [];
    /**
     * Cache for hide result for particular indexes.
     *
     * @private
     * @type {Array}
     */
    this.flattenHiddenList = [];
    /**
     * Cache for list of not hidden indexes, respecting the indexes sequence.
     *
     * @private
     * @type {Array}
     */
    this.notHiddenIndexesCache = [];
    /**
     * Flag determining whether operations performed on index mapper were batched.
     *
     * @private
     * @type {Boolean}
     */
    this.isBatched = false;
    /**
     * Flag determining whether any action on indexes sequence or skipped indexes was performed.
     *
     * @private
     * @type {Boolean}
     */
    this.cachedIndexesChange = false;

    this.indexesSequence.addLocalHook('change', () => {
      this.cachedIndexesChange = true;

      // Sequence of visible indexes might change.
      this.updateCache();

      this.runLocalHooks('change', this.indexesSequence, null);
    });

    this.skipMapsCollection.addLocalHook('change', (changedMap) => {
      this.cachedIndexesChange = true;

      // Number of indexes in the dataset might change.
      this.updateCache();

      this.runLocalHooks('change', changedMap, this.skipMapsCollection);
    });

    this.hiddenCollection.addLocalHook('change', (changedMap) => {
      this.cachedIndexesChange = true;

      // Number of rendered indexes might change.
      this.updateCache();

      this.runLocalHooks('change', changedMap, this.hiddenCollection);
    });

    this.variousMapsCollection.addLocalHook('change', (changedMap) => {
      this.runLocalHooks('change', changedMap, this.variousMapsCollection);8
    });
  }

  /**
   * Execute batch operations with updating cache.
   *
   * @param {Function} wrappedOperations Batched operations wrapped in a function.
   */
  executeBatchOperations(wrappedOperations) {
    const actualFlag = this.isBatched;

    this.isBatched = true;

    wrappedOperations();

    this.isBatched = actualFlag;

    this.updateCache();
  }

  /**
   * Register map which provide some index mappings.
   *
   * @param {String} uniqueName Name of the index map. It should be unique.
   * @param {IndexMap} indexMap Registered index map updated on items removal and insertion.
   * @returns {IndexMap}
   */
  registerMap(uniqueName, indexMap) {
    if (this.skipMapsCollection.get(uniqueName) || this.variousMapsCollection.get(uniqueName)) {
      throw Error(`Map with name "${uniqueName}" has been already registered.`);
    }

    if (indexMap instanceof SkipMap) {
      this.skipMapsCollection.register(uniqueName, indexMap);

    } else if (indexMap instanceof HiddenMap === true) {
      this.hiddenCollection.register(name, map);

    } else {
      this.variousMapsCollection.register(uniqueName, indexMap);
    }

    const numberOfIndexes = this.getNumberOfIndexes();
    /*
      We initialize map ony when we have full information about number of indexes and the dataset is not empty.
      Otherwise it's unnecessary. Initialization of empty array would not give any positive changes. After initializing
      it with number of indexes equal to 0 the map would be still empty. What's more there would be triggered
      not needed hook (no real change have occurred). Number of indexes is known after loading data (the `loadData`
      function from the `Core`).
     */
    if (numberOfIndexes > 0) {
      indexMap.init(numberOfIndexes);
    }

    return indexMap;
  }

  /**
   * Unregister a map with given name.
   *
   * @param {String} name Name of the index map.
   */
  unregisterMap(name) {
    this.skipMapsCollection.unregister(name);
    this.hiddenCollection.unregister(name);
    this.variousMapsCollection.unregister(name);
  }

  /**
   * Get physical index by its visual index.
   *
   * @param {Number} visualIndex Visual index.
   * @return {Number|null} Returns translated index mapped by passed visual index.
   */
  getPhysicalIndex(visualIndex) {
    const visibleIndexes = this.getNotSkippedIndexes();
    const numberOfVisibleIndexes = visibleIndexes.length;
    let physicalIndex = null;

    if (visualIndex < numberOfVisibleIndexes) {
      physicalIndex = visibleIndexes[visualIndex];
    }

    return physicalIndex;
  }

  /**
   * @TODO Description
   *
   * @param {Number} renderedIndex Rendered index.
   * @return {Number|null} Returns translated index mapped by passed visual index.
   */
  getRenderableIndex(renderedIndex) {
    const renderableIndexes = this.getNotHiddenIndexes();
    const numberOfVisibleIndexes = renderableIndexes.length;
    let physicalIndex = null;

    if (renderedIndex < numberOfVisibleIndexes) {
      physicalIndex = renderableIndexes[renderedIndex];
    }

    return physicalIndex;
  }

  /**
   * Get visual index by its physical index.
   *
   * @param {Number} physicalIndex Physical index to search.
   * @returns {Number|null} Returns a visual index of the index mapper.
   */
  getVisualIndex(physicalIndex) {
    const visibleIndexes = this.getNotSkippedIndexes();
    const visualIndex = visibleIndexes.indexOf(physicalIndex);

    if (visualIndex !== -1) {
      return visualIndex;
    }

    return null;
  }

  /**
   * Set default values for all stored index maps.
   *
   * @param {Number} [length] Destination length for all stored index maps.
   */
  initToLength(length = this.getNumberOfIndexes()) {
    this.flattenSkipList = [];
    this.notSkippedIndexesCache = [...new Array(length).keys()];
    this.flattenHiddenList = [];
    this.notHiddenIndexesCache = [...new Array(length).keys()];

    this.executeBatchOperations(() => {
      this.indexesSequence.init(length);
      this.skipMapsCollection.initEvery(length);
      this.hiddenCollection.initEvery(length);
      this.variousMapsCollection.initEvery(length);
    });

    this.runLocalHooks('init');
  }

  /**
   * Get all indexes sequence.
   *
   * @returns {Array} Physical indexes.
   */
  getIndexesSequence() {
    return this.indexesSequence.getValues();
  }

  /**
   * Set completely new indexes sequence.
   *
   * @param {Array} indexes Physical indexes.
   */
  setIndexesSequence(indexes) {
    this.indexesSequence.setValues(indexes);
  }

  /**
   * Get all indexes NOT skipped in the process of rendering.
   *
   * @param {Boolean} [readFromCache=true] Determine if read indexes from cache.
   * @returns {Array} Physical indexes.
   */
  getNotSkippedIndexes(readFromCache = true) {
    if (readFromCache === true) {
      return this.notSkippedIndexesCache;
    }

    return arrayFilter(this.getIndexesSequence(), index => this.isSkipped(index) === false);
  }

  /**
   * Get length of all indexes NOT skipped in the process of rendering.
   *
   * @returns {Number}
   */
  getNotSkippedIndexesLength() {
    return this.getNotSkippedIndexes().length;
  }

  /**
   * Get all indexes NOT skipped in the process of rendering.
   *
   * @param {Boolean} [readFromCache=true] Determine if read indexes from cache.
   * @returns {Array}
   */
  getNotHiddenIndexes(readFromCache = true) {
    if (readFromCache === true) {
      return this.notHiddenIndexesCache;
    }

    return arrayFilter(this.getIndexesSequence(), index => this.isHidden(index) === false);
  }

  /**
   * Get length of all indexes NOT skipped in the process of rendering.
   *
   * @returns {Number}
   */
  getNotHiddenIndexesLength() {
    return this.getNotHiddenIndexes().length;
  }

  /**
   * Get number of all indexes.
   *
   * @returns {Number}
   */
  getNumberOfIndexes() {
    return this.getIndexesSequence().length;
  }

  /**
   * Move indexes in the index mapper.
   *
   * @param {Number|Array} movedIndexes Visual index(es) to move.
   * @param {Number} finalIndex Visual index index being a start index for the moved element.
   */
  moveIndexes(movedIndexes, finalIndex) {
    if (typeof movedIndexes === 'number') {
      movedIndexes = [movedIndexes];
    }

    const physicalMovedIndexes = arrayMap(movedIndexes, visualIndex => this.getPhysicalIndex(visualIndex));
    const notSkippedIndexesLength = this.getNotSkippedIndexesLength();
    const movedIndexesLength = movedIndexes.length;

    // Removing indexes without re-indexing.
    const listWithRemovedItems = getListWithRemovedItems(this.getIndexesSequence(), physicalMovedIndexes);

    // When item(s) are moved after the last visible item we assign the last possible index.
    let destinationPosition = notSkippedIndexesLength - movedIndexesLength;

    // Otherwise, we find proper index for inserted item(s).
    if (finalIndex + movedIndexesLength < notSkippedIndexesLength) {
      // Physical index at final index position.
      const physicalIndex = listWithRemovedItems.filter(index => this.isSkipped(index) === false)[finalIndex];
      destinationPosition = listWithRemovedItems.indexOf(physicalIndex);
    }

    // Adding indexes without re-indexing.
    this.setIndexesSequence(getListWithInsertedItems(listWithRemovedItems, destinationPosition, physicalMovedIndexes));
  }

  /**
   * Get whether index is skipped in the process of rendering.
   *
   * @param {Number} physicalIndex Physical index.
   * @returns {Boolean}
   */
  isSkipped(physicalIndex) {
    return this.getFlattenSkipList()[physicalIndex] || false;
  }

  /**
   * Get whether index is skipped in the process of rendering.
   *
   * @private
   * @param {Number} physicalIndex Physical index.
   * @returns {Boolean}
   */
  isHidden(physicalIndex) {
    return this.getFlattenHiddenList()[physicalIndex] || false;
  }

  /**
   * Insert new indexes and corresponding mapping and update values of the others, for all stored index maps.
   *
   * @private
   * @param {Number} firstInsertedVisualIndex First inserted visual index.
   * @param {Number} amountOfIndexes Amount of inserted indexes.
   */
  insertIndexes(firstInsertedVisualIndex, amountOfIndexes) {
    const nthVisibleIndex = this.getNotSkippedIndexes()[firstInsertedVisualIndex];
    const firstInsertedPhysicalIndex = isDefined(nthVisibleIndex) ? nthVisibleIndex : this.getNumberOfIndexes();
    const insertionIndex = this.getIndexesSequence().includes(nthVisibleIndex) ? this.getIndexesSequence().indexOf(nthVisibleIndex) : this.getNumberOfIndexes();
    const insertedIndexes = arrayMap(new Array(amountOfIndexes).fill(firstInsertedPhysicalIndex), (nextIndex, stepsFromStart) => nextIndex + stepsFromStart);

    this.executeBatchOperations(() => {
      this.indexesSequence.insert(insertionIndex, insertedIndexes);
      this.skipMapsCollection.insertToEvery(insertionIndex, insertedIndexes);
      this.hiddenCollection.insertToEvery(insertionIndex, insertedIndexes);
      this.variousMapsCollection.insertToEvery(insertionIndex, insertedIndexes);
    });
  }

  /**
   * Remove some indexes and corresponding mappings and update values of the others, for all stored index maps.
   *
   * @private
   * @param {Array} removedIndexes List of removed indexes.
   */
  removeIndexes(removedIndexes) {
    this.executeBatchOperations(() => {
      this.indexesSequence.remove(removedIndexes);
      this.skipMapsCollection.removeFromEvery(removedIndexes);
      this.hiddenCollection.removeFromEvery(removedIndexes);
      this.variousMapsCollection.removeFromEvery(removedIndexes);
    });
  }

  /**
   * Get list of values, which represent result if index was skipped in any of skip collections.
   *
   * @private
   * @param {Boolean} [readFromCache=true] Determine if read indexes from cache.
   * @returns {Array}
   */
  getFlattenSkipList(readFromCache = true) {
    if (readFromCache === true) {
      return this.flattenSkipList;
    }

    if (this.skipMapsCollection.getLength() === 0) {
      return [];
    }

    const result = [];
    const particularSkipsLists = arrayMap(this.skipMapsCollection.get(), skipList => skipList.getValues());

    rangeEach(this.indexesSequence.getLength(), (physicalIndex) => {
      result[physicalIndex] = particularSkipsLists.some(particularSkipsList => particularSkipsList[physicalIndex]);
    });

    return result;
  }

  /**
   * Get flat list of values, which are result whether index was skipped in any of skip collection's element.
   *
   * @private
   * @param {Boolean} [readFromCache=true] Determine if read indexes from cache.
   * @returns {Array}
   */
  getFlattenHiddenList(readFromCache = true) {
    if (readFromCache === true) {
      return this.flattenHiddenList;
    }

    if (this.hiddenCollection.getLength() === 0) {
      return [];
    }

    const result = [];
    const particularHiddensLists = arrayMap([...this.skipMapsCollection.get(), ...this.hiddenCollection.get()], list => list.getValues());

    rangeEach(this.indexesSequence.getLength(), (physicalIndex) => {
      result[physicalIndex] = particularHiddensLists.some(particularHiddensList => particularHiddensList[physicalIndex]);
    });

    return result;
  }

  /**
   * Rebuild cache for some indexes. Every action on indexes sequence or skipped indexes by default reset cache,
   * thus batching some index maps actions is recommended.
   *
   * @param {Boolean} [force=false] Determine if force cache update.
   * @private
   */
  updateCache(force = false) {
    if (force === true || (this.isBatched === false && this.cachedIndexesChange === true)) {
      this.flattenSkipList = this.getFlattenSkipList(false);
      this.flattenHiddenList = this.getFlattenHiddenList(false);
      this.notSkippedIndexesCache = this.getNotSkippedIndexes(false);
      this.notHiddenIndexesCache = this.getNotHiddenIndexes(false);
      this.cachedIndexesChange = false;

      this.runLocalHooks('cacheUpdated');
    }
  }

  updateIndexesAfterRemoval(removedIndexes) {
    this.indexesSequence = this.getRemovedIndexes(this.indexesSequence, removedIndexes);
    this.skippedIndexes = this.getRemovedIndexes(this.skippedIndexes, removedIndexes);
    this.indexesSequence = this.getDecreasedIndexes(this.indexesSequence, removedIndexes);
    this.skippedIndexes = this.getDecreasedIndexes(this.skippedIndexes, removedIndexes);
  }

  getRemovedIndexes(indexesList, removedIndexes) {
    return arrayFilter(indexesList, index => removedIndexes.includes(index) === false);
  }

  getDecreasedIndexes(indexesList, removedIndexes) {
    return arrayMap(indexesList, index => index - removedIndexes.filter(removedRow => removedRow < index).length);
  }
}

mixin(IndexMapper, localHooks);

export default IndexMapper;
