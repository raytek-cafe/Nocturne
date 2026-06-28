/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

ChromeUtils.defineESModuleGetters(this, {
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
});

const ENGINE_FLAVOR = "text/x-moz-search-engine";

var gEngineView = null;

var gSearchPane = {
  _engineStore: null,
  _initialized: false,

  init() {
    if (this._initialized) {
      return;
    }
    this._initialized = true;

    this._engineStore = new EngineStore();
    gEngineView = new EngineView(this._engineStore);
    this._engineStore
      .init()
      .then(() => {
        gEngineView.invalidate();
        this.buildDefaultEngineDropDown();
      })
      .catch(console.error);

    Services.obs.addObserver(this, "browser-search-engine-modified");
    window.addEventListener("unload", () => {
      Services.obs.removeObserver(this, "browser-search-engine-modified");
    });
  },

  buildDefaultEngineDropDown() {
    let list = document.getElementById("defaultEngine");
    let currentEngine =
      list.selectedItem?.label || Services.search.defaultEngine.name;
    let engines = this._engineStore.engines;

    list.removeAllItems();
    if (!engines.length) {
      return;
    }

    if (!engines.some(engine => engine.name == currentEngine)) {
      currentEngine = engines[0].name;
    }

    for (let engine of engines) {
      let item = list.appendItem(engine.name);
      item.setAttribute(
        "class",
        "menuitem-iconic searchengine-menuitem menuitem-with-favicon"
      );
      if (engine.iconURL) {
        item.setAttribute("image", engine.iconURL);
      }
      item.engine = engine;
      if (engine.name == currentEngine) {
        list.selectedItem = item;
      }
    }
  },

  observe(engine, topic, data) {
    if (topic != "browser-search-engine-modified") {
      return;
    }

    this._engineStore.browserSearchEngineModified(engine, data);
    if (data != "engine-icon-changed") {
      this.buildDefaultEngineDropDown();
    }
  },

  onTreeSelect() {
    document.getElementById("removeEngineButton").disabled =
      !gEngineView.isEngineSelectedAndRemovable();
  },

  onTreeKeyPress(event) {
    let index = gEngineView.selectedIndex;
    let tree = document.getElementById("engineList");
    if (index == -1 || tree.hasAttribute("editing")) {
      return;
    }

    if (event.charCode == KeyEvent.DOM_VK_SPACE) {
      let newValue = !gEngineView._engineStore.engines[index].shown;
      gEngineView.setCellValue(
        index,
        tree.columns.getFirstColumn(),
        newValue.toString()
      );
      return;
    }

    let isMac = Services.appinfo.OS == "Darwin";
    if (
      (isMac && event.keyCode == KeyEvent.DOM_VK_RETURN) ||
      (!isMac && event.keyCode == KeyEvent.DOM_VK_F2)
    ) {
      tree.startEditing(index, tree.columns.getLastColumn());
    }
  },

  async onRestoreDefaults() {
    let num = await this._engineStore.restoreDefaultEngines();
    gEngineView.rowCountChanged(0, num);
    gEngineView.invalidate();
    this.buildDefaultEngineDropDown();
  },

  showRestoreDefaults(enable) {
    document.getElementById("restoreDefaultSearchEngines").disabled = !enable;
  },

  remove() {
    if (!gEngineView.isEngineSelectedAndRemovable()) {
      return;
    }

    let index = gEngineView.selectedIndex;
    gEngineView._engineStore.removeEngine(gEngineView.selectedEngine);
    gEngineView.invalidate();
    if (gEngineView.rowCount) {
      gEngineView.selection.select(Math.min(index, gEngineView.lastIndex));
      gEngineView.ensureRowIsVisible(Math.min(index, gEngineView.lastIndex));
    }
    document.getElementById("engineList").focus();
  },

  async editKeyword(engine, newKeyword) {
    if (newKeyword) {
      let duplicateEngine = false;
      let duplicateName = "";
      let duplicateBookmark = !!(await PlacesUtils.keywords.fetch(newKeyword));

      for (let otherEngine of gEngineView._engineStore.engines) {
        if (
          otherEngine.alias == newKeyword &&
          otherEngine.name != engine.name
        ) {
          duplicateEngine = true;
          duplicateName = otherEngine.name;
          break;
        }
      }

      if (duplicateEngine || duplicateBookmark) {
        let strings = document.getElementById("engineManagerBundle");
        let title = strings.getString("duplicateTitle");
        let bookmarkMsg = strings.getString("duplicateBookmarkMsg");
        let engineMsg = strings.getFormattedString("duplicateEngineMsg", [
          duplicateName,
        ]);

        Services.prompt.alert(
          window,
          title,
          duplicateEngine ? engineMsg : bookmarkMsg
        );
        return false;
      }
    }

    gEngineView._engineStore.changeEngine(engine, "alias", newKeyword);
    gEngineView.invalidate();
    this.buildDefaultEngineDropDown();
    return true;
  },

  saveOneClickEnginesList() {
    let hiddenList = [];
    for (let engine of gEngineView._engineStore.engines) {
      if (!engine.shown) {
        hiddenList.push(engine.name);
      }
    }
    document.getElementById("browser.search.hiddenOneOffs").value =
      hiddenList.join(",");
  },

  setDefaultEngine() {
    if (document.documentElement.instantApply) {
      Services.search.defaultEngine =
        document.getElementById(
          "defaultEngine"
        ).selectedItem.engine.originalEngine;
    }
  },

  loadAddEngines() {
    let url = Services.urlFormatter.formatURLPref(
      "browser.search.searchEnginesURL"
    );
    window.opener.openTrustedLinkIn(url, "tab");
    window.document.documentElement.acceptDialog();
  },
};

window.addEventListener("paneload", event => {
  if (event.target?.id == "paneSearch") {
    gSearchPane.init();
  }
});

function onDragEngineStart(event) {
  gEngineView.onDragEngineStart(event);
}

function EngineMoveOp(engineClone, newIndex) {
  this._engine = engineClone.originalEngine;
  this._newIndex = newIndex;
}
EngineMoveOp.prototype = {
  _engine: null,
  _newIndex: null,

  commit() {
    Services.search.moveEngine(this._engine, this._newIndex);
  },
};

function EngineRemoveOp(engineClone) {
  this._engine = engineClone.originalEngine;
}
EngineRemoveOp.prototype = {
  _engine: null,

  commit() {
    Services.search.removeEngine(
      this._engine,
      Ci.nsISearchService.CHANGE_REASON_USER
    );
  },
};

function EngineUnhideOp(engineClone, newIndex) {
  this._engine = engineClone.originalEngine;
  this._newIndex = newIndex;
}
EngineUnhideOp.prototype = {
  _engine: null,
  _newIndex: null,

  commit() {
    this._engine.hidden = false;
    Services.search.moveEngine(this._engine, this._newIndex);
  },
};

function EngineChangeOp(engineClone, prop, value) {
  this._engine = engineClone.originalEngine;
  this._prop = prop;
  this._newValue = value;
}
EngineChangeOp.prototype = {
  _engine: null,
  _prop: null,
  _newValue: null,

  commit() {
    this._engine[this._prop] = this._newValue;
  },
};

function EngineStore() {
  let pref = document.getElementById("browser.search.hiddenOneOffs").value;
  this.hiddenList = pref ? pref.split(",") : [];
  this._engines = [];
  this._defaultEngines = [];
  this._listeners = [];

  if (document.documentElement.instantApply) {
    this._ops = {
      push(op) {
        op.commit();
      },
    };
  } else {
    this._ops = [];
    document.documentElement.addEventListener("beforeaccept", () => {
      this.commit();
    });
  }
}
EngineStore.prototype = {
  _engines: null,
  _defaultEngines: null,
  _listeners: null,
  _ops: null,

  async init() {
    let visibleEngines = await Services.search.getVisibleEngines();
    for (let engine of visibleEngines) {
      this.addEngine(engine);
    }

    let defaultEngines = await Services.search.getAppProvidedEngines();
    this._defaultEngines = defaultEngines.map(this._cloneEngine, this);

    this.notifyRowCountChanged(0, visibleEngines.length);
    gSearchPane.showRestoreDefaults(
      this._defaultEngines.some(engine => engine.hidden)
    );
  },

  get engines() {
    return this._engines;
  },

  addListener(listener) {
    this._listeners.push(listener);
  },

  notifyRebuildViews() {
    for (let listener of this._listeners) {
      listener.rebuild();
    }
  },

  notifyRowCountChanged(index, count) {
    for (let listener of this._listeners) {
      listener.rowCountChanged(index, count);
    }
  },

  notifyEngineIconUpdated(engine) {
    let index = this._getIndexForEngine(engine);
    if (index == -1) {
      return;
    }

    for (let listener of this._listeners) {
      if ("engineIconUpdated" in listener) {
        listener.engineIconUpdated(index);
      }
    }
    gSearchPane.buildDefaultEngineDropDown();
  },

  _getIndexForEngine(engine) {
    return this._engines.indexOf(engine);
  },

  _getEngineByName(name) {
    return this._engines.find(engine => engine.name == name) || null;
  },

  _cloneEngine(engine) {
    let clone = {
      alias: engine.alias,
      hidden: engine.hidden,
      iconURL: "",
      id: engine.id,
      isAppProvided: !!engine.isAppProvided,
      name: engine.name,
      originalEngine: engine,
    };
    clone.shown = !this.hiddenList.includes(clone.name);

    engine
      .getIconURL()
      .then(iconURL => {
        clone.iconURL = iconURL || "";
        if (!clone.iconURL) {
          this.notifyEngineIconUpdated(clone);
          return;
        }

        let img = new Image();
        let onDone = () => {
          img.onload = null;
          img.onerror = null;
          this.notifyEngineIconUpdated(clone);
        };
        img.onload = onDone;
        img.onerror = onDone;
        img.src = clone.iconURL;
      })
      .catch(console.error);

    return clone;
  },

  _isSameEngine(engineClone) {
    return engineClone.originalEngine.id == this.originalEngine.id;
  },

  commit() {
    for (let op of this._ops) {
      op.commit();
    }

    let selectedItem = document.getElementById("defaultEngine").selectedItem;
    if (selectedItem) {
      Services.search.defaultEngine = selectedItem.engine.originalEngine;
    }
  },

  addEngine(engine) {
    this._engines.push(this._cloneEngine(engine));
  },

  updateEngine(newEngine) {
    let index = this._engines.findIndex(
      engine => engine.originalEngine.id == newEngine.id
    );
    if (index == -1) {
      return;
    }

    let shown = this._engines[index].shown;
    let clone = this._cloneEngine(newEngine);
    clone.shown = shown;
    this._engines[index] = clone;
  },

  moveEngine(engine, newIndex) {
    if (newIndex < 0 || newIndex > this._engines.length - 1) {
      throw new Error("ES_moveEngine: invalid aNewIndex!");
    }

    let index = this._getIndexForEngine(engine);
    if (index == -1) {
      throw new Error("ES_moveEngine: invalid engine?");
    }
    if (index == newIndex) {
      return;
    }

    let removedEngine = this._engines.splice(index, 1)[0];
    this._engines.splice(newIndex, 0, removedEngine);
    this._ops.push(new EngineMoveOp(engine, newIndex));
  },

  removeEngine(engine) {
    if (this._engines.length == 1) {
      throw new Error("Cannot remove last engine!");
    }

    let engineId = engine.id || engine.originalEngine?.id;
    let index = this._engines.findIndex(element => element.id == engineId);
    if (index == -1) {
      throw new Error("invalid engine?");
    }

    let removed = this._engines.splice(index, 1)[0];
    this._ops.push(new EngineRemoveOp(removed));
    if (removed.isAppProvided) {
      gSearchPane.showRestoreDefaults(true);
    }
    this.notifyRowCountChanged(index, -1);
  },

  async restoreDefaultEngines() {
    let added = 0;

    for (let i = 0; i < this._defaultEngines.length; ++i) {
      let engine = this._defaultEngines[i];
      if (this._engines.some(this._isSameEngine, engine)) {
        this.moveEngine(this._getEngineByName(engine.name), i);
      } else {
        engine.alias = "";
        this._engines.splice(i, 0, engine);
        this._ops.push(new EngineUnhideOp(engine, i));
        added++;
      }
    }

    gSearchPane.showRestoreDefaults(false);
    this.notifyRebuildViews();
    return added;
  },

  changeEngine(engine, prop, value) {
    let index = this._getIndexForEngine(engine);
    if (index == -1) {
      throw new Error("invalid engine?");
    }

    this._engines[index][prop] = value;
    this._ops.push(new EngineChangeOp(engine, prop, value));
  },

  browserSearchEngineModified(engine, data) {
    engine.QueryInterface(Ci.nsISearchEngine);
    switch (data) {
      case "engine-added":
        this.addEngine(engine);
        this.notifyRowCountChanged(this._engines.length - 1, 1);
        break;
      case "engine-changed":
      case "engine-icon-changed":
        this.updateEngine(engine);
        this.notifyRebuildViews();
        break;
      case "engine-removed":
        this.removeEngine(engine);
        break;
      case "engine-default":
        break;
    }
  },
};

function EngineView(engineStore) {
  this._engineStore = engineStore;
  this._engineList = document.getElementById("engineList");
  this._engineList.view = this;
  this._engineStore.addListener(this);
}
EngineView.prototype = {
  _engineStore: null,
  _engineList: null,
  tree: null,
  selection: null,

  get lastIndex() {
    return this.rowCount - 1;
  },

  get selectedIndex() {
    let selection = this.selection;
    if (selection && selection.getRangeCount() > 0) {
      let min = {};
      selection.getRangeAt(0, min, {});
      return min.value;
    }
    return -1;
  },

  get selectedEngine() {
    return this._engineStore.engines[this.selectedIndex];
  },

  get rowCount() {
    return this._engineStore.engines.length;
  },

  rebuild() {
    this.invalidate();
  },

  rowCountChanged(index, count) {
    if (!this.tree) {
      return;
    }
    this.tree.rowCountChanged(index, count);
  },

  engineIconUpdated(index) {
    if (!this.tree) {
      return;
    }
    this.tree.invalidateCell(
      index,
      this.tree.columns.getNamedColumn("engineName")
    );
  },

  invalidate() {
    if (this.tree) {
      this.tree.invalidate();
    }
  },

  ensureRowIsVisible(index) {
    if (this.tree) {
      this.tree.ensureRowIsVisible(index);
    }
  },

  getSourceIndexFromDrag(dataTransfer) {
    return parseInt(dataTransfer.getData(ENGINE_FLAVOR));
  },

  isCheckBox(_index, column) {
    return column.id == "engineShown";
  },

  isEngineSelectedAndRemovable() {
    let defaultEngine = Services.search.defaultEngine;
    return (
      this.selectedIndex != -1 &&
      this.lastIndex != 0 &&
      this.selectedEngine.name != defaultEngine.name
    );
  },

  onDragEngineStart(event) {
    let selectedIndex = this.selectedIndex;
    let cell = this._engineList.getCellAt(event.clientX, event.clientY);
    if (selectedIndex >= 0 && !this.isCheckBox(cell.row, cell.col)) {
      event.dataTransfer.setData(ENGINE_FLAVOR, selectedIndex.toString());
      event.dataTransfer.effectAllowed = "move";
    }
  },

  getImageSrc(index, column) {
    if (column.id == "engineName") {
      return this._engineStore.engines[index].iconURL;
    }
    return "";
  },

  getCellText(index, column) {
    if (column.id == "engineName") {
      return this._engineStore.engines[index].name;
    }
    if (column.id == "engineKeyword") {
      return this._engineStore.engines[index].alias;
    }
    return "";
  },

  setTree(tree) {
    this.tree = tree;
  },

  canDrop(targetIndex, orientation, dataTransfer) {
    let sourceIndex = this.getSourceIndexFromDrag(dataTransfer);
    return (
      sourceIndex != -1 &&
      sourceIndex != targetIndex &&
      sourceIndex != targetIndex + orientation
    );
  },

  drop(dropIndex, orientation, dataTransfer) {
    let sourceIndex = this.getSourceIndexFromDrag(dataTransfer);
    let sourceEngine = this._engineStore.engines[sourceIndex];

    if (dropIndex > sourceIndex) {
      if (orientation == Ci.nsITreeView.DROP_BEFORE) {
        dropIndex--;
      }
    } else if (orientation == Ci.nsITreeView.DROP_AFTER) {
      dropIndex++;
    }

    this._engineStore.moveEngine(sourceEngine, dropIndex);
    gSearchPane.showRestoreDefaults(true);
    gSearchPane.buildDefaultEngineDropDown();
    this.invalidate();
    this.selection.select(dropIndex);
  },

  getRowProperties(_index) {
    return "";
  },
  getCellProperties(_index, _column) {
    return "";
  },
  getColumnProperties(_column) {
    return "";
  },
  isContainer(_index) {
    return false;
  },
  isContainerOpen(_index) {
    return false;
  },
  isContainerEmpty(_index) {
    return false;
  },
  isSeparator(_index) {
    return false;
  },
  isSorted(_index) {
    return false;
  },
  getParentIndex(_index) {
    return -1;
  },
  hasNextSibling(_parentIndex, _index) {
    return false;
  },
  getLevel(_index) {
    return 0;
  },
  getProgressMode(_index, _column) {
    return undefined;
  },

  getCellValue(index, column) {
    if (column.id == "engineShown") {
      return this._engineStore.engines[index].shown;
    }
    return undefined;
  },

  toggleOpenState(_index) {},
  cycleHeader(_column) {},
  selectionChanged() {},
  cycleCell(_row, _column) {},

  isEditable(_index, column) {
    return column.id != "engineName";
  },

  isSelectable(_index, _column) {
    return false;
  },

  setCellValue(index, column, value) {
    if (column.id == "engineShown") {
      this._engineStore.engines[index].shown = value == "true";
      gSearchPane.saveOneClickEnginesList();
      this.invalidate();
    }
  },

  setCellText(index, column, value) {
    if (column.id == "engineKeyword") {
      gSearchPane
        .editKeyword(this._engineStore.engines[index], value)
        .then(valid => {
          if (!valid) {
            this._engineList.startEditing(index, column);
          }
        });
    }
  },

  performAction(_action) {},
  performActionOnRow(_action, _index) {},
  performActionOnCell(_action, _index, _column) {},
};
