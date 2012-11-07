const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const Lang = imports.lang;

const Tweener = imports.ui.tweener;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const PanelMenu = imports.ui.panelMenu;
const Layout = imports.ui.layout;
const ExtensionSystem = imports.ui.extensionSystem;

const ShellVersion = imports.misc.config.PACKAGE_VERSION.split('.');
let ExtensionPath;
if (ShellVersion[1] === 2) {
    ExtensionPath = ExtensionSystem.extensionMeta['panelSettings@eddiefullmetal.gr'].path;
} else {
    ExtensionPath = imports.misc.extensionUtils.getCurrentExtension().path;
}

// compatibility. _statusArea -> statusArea
function _getUserMenu() {
    return (Main.panel._statusArea || Main.panel.statusArea).userMenu;
}
// compatibility panel._menus -> panel.menuManager
function _getMenuManager() {
    return (Main.panel._menus || Main.panel.menuManager);
}


/* Generic Helper Classes */
function MenuHook(menuAddedCallback, menuRemovedCallback){
    this._init(menuAddedCallback, menuRemovedCallback);
}

MenuHook.prototype = {
    _init: function(menuAddedCallback, menuRemovedCallback){
        this._menuManager = _getMenuManager();
        this._originalAddMenuFunc = this._menuManager.addMenu;
        this._originalRemoveMenuFunc = this._menuManager.removeMenu;
        this._menuAddedCallback = menuAddedCallback;
        this._menuRemovedCallback = menuRemovedCallback;

        this._menuManager.addMenu =  Lang.bind(this, function(menu, position){
            this._originalAddMenuFunc.apply(this._menuManager, [menu, position]);            
            this._menuAddedCallback(menu, position);
        });

        this._menuManager.removeMenu = Lang.bind(this, function(menu){
            this._originalRemoveMenuFunc.apply(this._menuManager, [menu]);         
            this._menuRemovedCallback(menu);
        });
    },
    destroy: function(){
        this._menuManager.addMenu = this._originalAddMenuFunc;
        this._menuManager.removeMenu = this._originalAddMenuFunc;
        this._menuManager = null;
    }
}

function SettingsManager(){
    this._init();
}

SettingsManager.prototype = {
    _init: function(){
        this._file = Gio.file_new_for_path(ExtensionPath + '/settings.json');
        this.settings = new Object;
    },
    save: function(){
        this._file.replace_contents(JSON.stringify(this.settings), null, false, 0, null);
    },
    load: function(){
        if(this._file.query_exists(null)) {
            [flag, data] = this._file.load_contents(null);

            if(flag){
                this.settings = JSON.parse(data);
            }
        }
    }
}

function OverviewCorner(){
    this._init();
}

OverviewCorner.prototype = {
    _init:function(){
        this._hotCorner = new Layout.HotCorner();  

        // GNOME 3.6: no visibleInFullscreen property, it's default
        // GNOME 3.2 to 3.4 need visibleInFullscreen: true
        if (ShellVersion[1] < 6) {
            Main.layoutManager.addChrome(this._hotCorner.actor, {visibleInFullscreen:true});
        } else {
            Main.layoutManager.addChrome(this._hotCorner.actor);
        }
    },
    enable: function(){
        this._hotCorner.actor.show();
    },
    disable: function(){
        this._hotCorner.actor.hide();
    },
    destroy: function(){
        this._hotCorner.destroy();
    }
}

/* A slider with a label + number that updates with the slider
 * text: the text for the item
 * defaultVal: the intial value for the item (on the min -> max scale)
 * min, max: the min and max values for the slider
 * round: whether to round the value to the nearest integer
 * ndec: number of decimal places to round to
 * params: other params for PopupBaseMenuItem
 */
function PopupSliderMenuItem() {
    this._init.apply(this, arguments);
}
PopupSliderMenuItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,
    _init: function (text, defaultVal, min, max, round, ndec, params) {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);

        /* set up properties */
        this.min = min || 0;
        this.max = max || 1;
        this.round = round || false;
        this._value = defaultVal;
        if (round) {
            this._value = Math.round(this._value);
        }
        this.ndec = this.ndec || (round ? 0 : 2);

        /* set up item */
        this.box = new St.BoxLayout({vertical: true});
        this.addActor(this.box, {expand: true, span: -1});

        this.topBox = new St.BoxLayout({vertical: false,
            style_class: 'slider-menu-item-top-box'});
        this.box.add(this.topBox, {x_fill: true});

        this.bottomBox = new St.BoxLayout({vertical: false,
            style_class: 'slider-menu-item-bottom-box'});
        this.box.add(this.bottomBox, {x_fill: true});

        this.label = new St.Label({text: text, reactive: false});
        this.numberLabel = new St.Label({text: this._value.toFixed(this.ndec),
            reactive: false});
        this.slider = new PopupMenu.PopupSliderMenuItem((defaultVal - min) /
            (max - min)); // between 0 and 1

        /* connect up signals */
        this.slider.connect('value-changed', Lang.bind(this, function (s, v) {
            this._updateValue(s, v);
            this.emit('value-changed', this._value);
        }));
        /* pass through the drag-end, clicked signal */
        this.slider.connect('drag-end', Lang.bind(this, function () {
            this.emit('drag-end', this._value);
        }));
        // Note: if I set the padding in the css it gets overridden
        this.slider.actor.set_style('padding-left: 0em; padding-right: 0em;');

        /* assemble the item */
        this.topBox.add(this.label, {expand: true});
        this.topBox.add(this.numberLabel, {align: St.Align.END});
        this.bottomBox.add(this.slider.actor, {expand: true, span: -1});
    },
    /* returns the value of the slider, either the raw (0-1) value or the
     * value on the min->max scale. */
    getValue: function (raw) {
        if (raw) {
            return this.slider.value;
        } else {
            return this._value;
        }
    },
    /* sets the value of the slider, either the raw (0-1) value or the
     * value on the min->max scale */
    setValue: function (value, raw) {
        value = (raw ? value : (value - this.min) / (this.max - this.min));
        this._updateValue(this.slider, value);
        this.slider.setValue(value);
    },
    _updateValue: function (slider, value) {
        let val = value * (this.max - this.min) + this.min;
        if (this.round) {
            val = Math.round(val);
        }
        this._value = val;
        this.numberLabel.set_text(val.toFixed(this.ndec));
    }
};

/* Panel Visibility States */

//Visibility States
const VISIBILITY_NORMAL = -1;
const VISIBILITY_AUTOHIDE = 0;
const VISIBILITY_OVERVIEW_ONLY = 1;

//Edges
const EDGE_TOP = 0;
const EDGE_BOTTOM = 1;

/* Base State */
function VisibilityBaseState(originalPanelHeight){
    this._init(originalPanelHeight);
}

VisibilityBaseState.prototype = {
    _init: function(originalPanelHeight){
        this._originalPanelHeight = originalPanelHeight;
        this._actor = Main.panel.actor.get_parent();
        this._monitor = Main.layoutManager.primaryMonitor;
    },
    onPanelMouseEnter: function(){
    },
    onPanelMouseLeave: function(){
    },
    onOverviewHiding: function(){
    },
    onOverviewShowing: function(){
    },
    onMenuOpenStateChanged: function(menu, open){
    },
    destroy: function(){
    },
    _hidePanelCompletely: function(){
        this._hidePanelNoAnim();
        this._actor.hide();
    },
    _hidePanelNoAnim: function(){      
        switch(Main.panel.edge){
            case EDGE_TOP:
                this._actor.set_height(1);
                this._actor.set_opacity(0);
                this._actor.set_clip(this._monitor.x, this._monitor.y, this._actor.get_width(), 1);
                break;
            case EDGE_BOTTOM:
                let y = this._actor.get_y() + this._actor.get_height() -1;
                this._actor.set_y(y);
                this._actor.set_opacity(0);
                break;
        }
    },
    _showPanelNoAnim: function(){  
        this._actor.show();  

        switch(Main.panel.edge){
            case EDGE_TOP:
                this._actor.set_height(this._originalPanelHeight);
                this._actor.set_opacity(255);
                this._actor.remove_clip();
                break;
            case EDGE_BOTTOM:
                this._actor.set_y(this._monitor.height - this._actor.get_height());
                this._actor.set_opacity(255);
                break;
        }
    },
    _hidePanel: function(){
        switch(Main.panel.edge){
            case EDGE_TOP:    
                Tweener.addTween(this._actor, {
                    height: 1,
                    time: 0.3,
                    transition: 'easeOutQuad',
                    onUpdate: Lang.bind(this, function() {
                        this._actor.set_clip(this._monitor.x, this._monitor.y, this._actor.get_width(), this._actor.get_height());
                    }),
                    onComplete: Lang.bind(this, function() {
                        this._actor.set_opacity(0);
                    })
                });
                break;
            case EDGE_BOTTOM:
                Tweener.addTween(this._actor, {
                    y: this._actor.get_y() + this._actor.get_height() - 1,
                    time: 0.3,
                    transition: 'easeOutQuad',
                    onComplete: Lang.bind(this, function() {
                        this._actor.set_opacity(0);
                    })
                });
                break;
        }
    },
    _showPanel: function(){
        this._actor.show();
        this._actor.set_opacity(255);

        switch(Main.panel.edge){
            case EDGE_TOP:    
                Tweener.addTween(this._actor, {
                    height: this._originalPanelHeight,
                    time: 0.3,
                    transition: 'easeOutQuad',
                    onComplete: Lang.bind(this, function() {
                        this._actor.remove_clip();
                    }),
                    onUpdate: Lang.bind(this, function() {
                        this._actor.set_clip(this._monitor.x, this._monitor.y, this._actor.get_width(), this._actor.get_height());
                    })
                });
                break;
            case EDGE_BOTTOM:
                Tweener.addTween(this._actor, {
                    y: this._monitor.height - this._actor.get_height(),
                    time: 0.3,
                    transition: 'easeOutQuad'
                });
                break;
        }
    }
}

/* None State */
function VisibilityNormalState(originalPanelHeight){
    this._init(originalPanelHeight);
}

VisibilityNormalState.prototype = {
    __proto__: VisibilityBaseState.prototype,
    _init: function(originalPanelHeight){
        VisibilityBaseState.prototype._init.call(this, originalPanelHeight);

        this._showPanel();
    }
}

/* Autohide State */
function VisibilityAutohideState(originalPanelHeight){
    this._init(originalPanelHeight);
}

VisibilityAutohideState.prototype = {
    __proto__: VisibilityBaseState.prototype,
    _init: function(originalPanelHeight){
        VisibilityBaseState.prototype._init.call(this, originalPanelHeight);

        Main.layoutManager.removeChrome(this._actor);
        Main.layoutManager.addChrome(this._actor, { affectsStruts: false});
        
        if(!Main.overview.visible){
            this._hidePanel();
        }
    },
    onPanelMouseEnter: function(){
        this._pendingHideRequest = false;
        this._showPanel();
    },
    onPanelMouseLeave: function(){
        //If the overview is visible or a menu is shown do not hide the panel
        var canHide = !Main.overview.visible && _getMenuManager()._activeMenu == null;
        this._pendingHideRequest = !canHide;
        if(canHide){
            this._hidePanel();
        }
    },
    onOverviewHiding: function(){
        this._hidePanelNoAnim();
    },
    onOverviewShowing: function(){
        this._showPanelNoAnim();
    },
    onMenuOpenStateChanged: function(menu, open){
        if(!open && this._pendingHideRequest && !Main.overview.visible){
            this._hidePanel();
        }
    },
    destroy: function(){
        Main.layoutManager.removeChrome(this._actor);
        Main.layoutManager.addChrome(this._actor, { affectsStruts: true});
        
        this._showPanel();
    }
}

/* Overview Only State */
function VisibilityOverviewOnlyState(originalPanelHeight){
    this._init(originalPanelHeight);
}

VisibilityOverviewOnlyState.prototype = {
    __proto__: VisibilityBaseState.prototype,
    _init: function(originalPanelHeight){
        VisibilityBaseState.prototype._init.call(this, originalPanelHeight);
        this._overviewCorner = new OverviewCorner;

        if(!Main.overview.visible){
            this._hidePanelCompletely();
        }
    },
    onOverviewHiding: function(){
        this._overviewCorner.enable();
        this._hidePanelCompletely();
    },
    onOverviewShowing: function(){
        this._overviewCorner.disable();
        this._showPanelNoAnim();
    },
    destroy: function(){
        this._overviewCorner.destroy();
        this._showPanelNoAnim();
    }
}

/* Panel Visibility Manager */
function PanelVisibilityManager(settings){
    this._init(settings);
}

PanelVisibilityManager.prototype = {
    _init: function(settings){
        this._originalHeight = Main.panel.actor.get_height();
        this._settings = settings;

        if(this._settings.settings.visibilityState != undefined){
            this.setState(this._settings.settings.visibilityState);
        }else{
            this.setState(VISIBILITY_NORMAL);
        }

        this._panelEnterEventId = Main.panel.actor.connect('enter-event', Lang.bind(this, this._onPanelMouseEnter));
        this._panelLeaveEventId = Main.panel.actor.connect('leave-event', Lang.bind(this, this._onPanelMouseLeave));
        this._overviewHidingEventId = Main.overview.connect('hiding', Lang.bind(this, this._onOverviewHiding));
        this._overviewShowingEventId = Main.overview.connect('showing', Lang.bind(this, this._onOverviewShowing));

        let menuAddedCallback = Lang.bind(this, this._menuAdded);
        let menuRemovedCallback = Lang.bind(this, this._menuRemoved);

        this._menuHook = new MenuHook(menuAddedCallback, menuRemovedCallback);

        this._menuData = new Array;

        let menuManager = _getMenuManager();
        for(let menuIndex in menuManager._menus){
            this._menuAdded(menuManager._menus[menuIndex].menu);
        }
    },
    setState: function(visibilityState){
        this.visibilityState = visibilityState;
        this._settings.settings.visibilityState = this.visibilityState; 
        this._settings.save();

        if(this._visibilityStateImpl){
            this._visibilityStateImpl.destroy();
        }

        switch(this.visibilityState){
            case VISIBILITY_AUTOHIDE:
                this._visibilityStateImpl = new VisibilityAutohideState(this._originalHeight);
                break;
            case VISIBILITY_OVERVIEW_ONLY:
                this._visibilityStateImpl = new VisibilityOverviewOnlyState(this._originalHeight);
                break;
            case VISIBILITY_NORMAL:
                this._visibilityStateImpl = new VisibilityNormalState(this._originalHeight);
                break;
        }
    },
    _onPanelMouseEnter: function(){
        this._visibilityStateImpl.onPanelMouseEnter();
    },
    _onPanelMouseLeave: function(){
        this._visibilityStateImpl.onPanelMouseLeave();
    },
    _onMenuOpenStateChanged: function(menu, open){
        this._visibilityStateImpl.onMenuOpenStateChanged();
    },
    _onOverviewHiding: function(){
        this._visibilityStateImpl.onOverviewHiding();
    },
    _onOverviewShowing: function(){
        this._visibilityStateImpl.onOverviewShowing();
    },
    _menuAdded: function(menu){
        let eventId = menu.connect('open-state-changed', Lang.bind(this, this._onMenuOpenStateChanged));
        this._menuData.push({ menu: menu, eventId: eventId});
    },
    _menuRemoved: function(menu){
        let index = this._findMenuData(menu);

        let menuData = this._menuData[index];
        menuData.menu.disconnect(menuData.eventId);

        delete this._menuData[index];
    },
    _findMenuData: function(menu){
        for(let menuDataIndex in this._menuData){
            if(this._menuData[menuDataIndex] == menu){
                return menuDataIndex;
            }
        }
        
        return -1;
    },
    destroy: function(){
        this._visibilityStateImpl.destroy();
        
        Main.panel.actor.disconnect(this._panelEnterEventId);
        Main.panel.actor.disconnect(this._panelLeaveEventId);
        Main.overview.disconnect(this._overviewHidingEventId);
        Main.overview.disconnect(this._overviewShowingEventId);

        for(let menuDataIndex in this._menuData){
            let menuData = this._menuData[menuDataIndex];
            menuData.menu.disconnect(menuData.eventId);
        }

        this._menuHook.destroy();
    }
}

/* Panel Edge Manager */
function PanelEdgeManager(settings){
    this._init(settings);
}

PanelEdgeManager.prototype = {
    _init: function(settings){
        this._settings = settings;

        let menuAddedCallback = Lang.bind(this, this._menuAdded);
        let menuRemovedCallback = Lang.bind(this, this._menuRemoved);         

        this._menuHook = new MenuHook(menuAddedCallback, menuRemovedCallback);
        this._overviewCorner = new OverviewCorner;

        if(this._settings.settings.edge != undefined){
            this.setEdge(this._settings.settings.edge, false);
        }else{
            this.setEdge(EDGE_TOP, true);
        }
    },
    setEdge: function(edge, save){
        this.edge = edge;

        if(save){
            this._settings.settings.edge = this.edge; 
            this._settings.save();
        }

        switch(this.edge){
            case EDGE_TOP:
                Main.messageTray.actor.get_parent().set_y(Main.layoutManager.primaryMonitor.height - Main.messageTray.actor.get_parent().get_height());
                Main.panel.actor.get_parent().set_y(Main.layoutManager.primaryMonitor.y);
                this._overviewCorner.disable();
                this._arrowSide = St.Side.TOP;
                break;
            case EDGE_BOTTOM:
                Main.messageTray.actor.get_parent().set_y(Main.layoutManager.primaryMonitor.height - Main.panel.actor.get_height());
                Main.panel.actor.get_parent().set_y(Main.layoutManager.primaryMonitor.height - Main.panel.actor.get_height());
                this._overviewCorner.enable();
                this._arrowSide = St.Side.BOTTOM;
                break;
        }
        
        Main.panel.edge = this.edge;

        this._updateMenuArrowSide();
    },
    _updateMenuArrowSide: function(){
        let menuManager = _getMenuManager();
        for(let menuIndex in menuManager._menus){
            this._menuAdded(menuManager._menus[menuIndex].menu);
        }
    },
    _menuAdded: function(menu){
        menu._boxPointer._arrowSide = this._arrowSide;
    },
    _menuRemoved: function(menu){
    },
    destroy: function(){
        this.setEdge(EDGE_TOP, false);
        this._menuHook.destroy();
        this._overviewCorner.destroy();
    }
}

/* Panel Settings */
function PanelSettings() {
    this._init();
}

PanelSettings.prototype = {
    _init: function() {
        this._settings = new SettingsManager();
        this._settings.load();
        
        this._panelSettingsMenu = new PopupMenu.PopupSubMenuMenuItem("Panel Settings");

        this._edgeManager = new PanelEdgeManager(this._settings);
        this._visibilityManager = new PanelVisibilityManager(this._settings);
        
        this._createVisibilityMenu();
        this._panelSettingsMenu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._createEdgeMenu();
        this._panelSettingsMenu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._createTransparencyMenu();

        _getUserMenu().menu.addMenuItem(this._panelSettingsMenu, 5);
    },
    _createVisibilityMenu: function(){
        this._visibilityItems = new Array;

        this._panelVisibilityTitle = new PopupMenu.PopupMenuItem("Visibility", { reactive: false });
        this._panelVisibilityTitle.label.set_style('font-weight:bold');
        this._panelSettingsMenu.menu.addMenuItem(this._panelVisibilityTitle);
    
        this._visibilityItems[VISIBILITY_NORMAL] = new PopupMenu.PopupMenuItem("Normal");
        this._visibilityItems[VISIBILITY_NORMAL].connect('activate', Lang.bind(this, this._onVisibilityNormalItemClick));
        this._panelSettingsMenu.menu.addMenuItem(this._visibilityItems[VISIBILITY_NORMAL]);
        
        this._visibilityItems[VISIBILITY_AUTOHIDE] = new PopupMenu.PopupMenuItem("Autohide");
        this._visibilityItems[VISIBILITY_AUTOHIDE].connect('activate', Lang.bind(this, this._onVisibilityAutohideItemClick));
        this._panelSettingsMenu.menu.addMenuItem(this._visibilityItems[VISIBILITY_AUTOHIDE]);

        this._visibilityItems[VISIBILITY_OVERVIEW_ONLY] = new PopupMenu.PopupMenuItem("Overview Only");
        this._visibilityItems[VISIBILITY_OVERVIEW_ONLY].connect('activate', Lang.bind(this, this._onVisibilityOverviewOnlyItemClick));        
        this._panelSettingsMenu.menu.addMenuItem(this._visibilityItems[VISIBILITY_OVERVIEW_ONLY]);
        
        this._updateVisibilityState();
    },
    _createEdgeMenu: function(){
        this._panelEdgeTitle = new PopupMenu.PopupMenuItem("Edge", { reactive: false });
        this._panelEdgeTitle.label.set_style('font-weight:bold');
        this._panelSettingsMenu.menu.addMenuItem(this._panelEdgeTitle);

        this._edgeItems = new Array;

        this._edgeItems[EDGE_TOP] = new PopupMenu.PopupMenuItem("Top");
        this._edgeItems[EDGE_TOP].connect('activate', Lang.bind(this, this._onEdgeTopItemClick));
        this._panelSettingsMenu.menu.addMenuItem(this._edgeItems[EDGE_TOP]);

        this._edgeItems[EDGE_BOTTOM] = new PopupMenu.PopupMenuItem("Bottom");
        this._edgeItems[EDGE_BOTTOM].connect('activate', Lang.bind(this, this._onEdgeBottomItemClick));
        this._panelSettingsMenu.menu.addMenuItem(this._edgeItems[EDGE_BOTTOM]);

        this._updateEdgeState();
    },
    _createTransparencyMenu: function(){
        // TODO: launch a Gtk widget to select bg colour/image
        let op = this._settings.settings.opacity;
        if (op === null || op === undefined) {
            op = 255;
        }
        this._transparencyItem = new PopupSliderMenuItem("Opacity",
            op, 0, 255, true, 0);
        this._panelSettingsMenu.menu.addMenuItem(this._transparencyItem);
        this._transparencyItem.connect('value-changed', Lang.bind(this, this._onTransparencyChanged));
        this._onTransparencyChanged(this._transparencyItem, op);
    },
    _onTransparencyChanged: function(slider, alpha) {
        if (this._settings.settings.opacity === alpha && Main.panel.actor.style) {
            return;
        }
        // TODO: works for panel corners in GNOME 3.2 but *NOT* the panel!
        let col = Main.panel.actor.get_theme_node().get_background_color();
        col = 'rgba(%d, %d, %d, %.2f)'.format(col.red, col.green, col.blue, alpha/255);
        Main.panel.actor.style = 'background-color: ' + col;
        Main.panel._leftCorner.actor.style = '-panel-corner-background-color: ' + col;
        Main.panel._rightCorner.actor.style = '-panel-corner-background-color: ' + col;
        this._settings.settings.opacity = alpha;
        this._settings.save();
    },
    _updateTransparency: function(slider, alpha, save) {
    },
    _onVisibilityOverviewOnlyItemClick: function(){
        this._visibilityManager.setState(VISIBILITY_OVERVIEW_ONLY);
        this._updateVisibilityState();
    },
    _onVisibilityAutohideItemClick: function(){
        this._visibilityManager.setState(VISIBILITY_AUTOHIDE);
        this._updateVisibilityState();
    },
    _onVisibilityNormalItemClick: function(){
        this._visibilityManager.setState(VISIBILITY_NORMAL);
        this._updateVisibilityState();
    },
    _onEdgeTopItemClick: function(){
        this._edgeManager.setEdge(EDGE_TOP, true);
        this._updateEdgeState();
    },
    _onEdgeBottomItemClick: function(){
        this._edgeManager.setEdge(EDGE_BOTTOM, true);
        this._updateEdgeState();
    },
    _updateVisibilityState: function(){
        for(let index in this._visibilityItems){
            this._visibilityItems[index].setShowDot(false);
        }
        
        this._visibilityItems[this._visibilityManager.visibilityState].setShowDot(true);
    },
    _updateEdgeState: function(){
        for(let index in this._edgeItems){
            this._edgeItems[index].setShowDot(false);
        }
        
        this._edgeItems[this._edgeManager.edge].setShowDot(true);
    },
    destroy: function(){
        this._panelSettingsMenu.destroy();
        this._visibilityManager.destroy();
        this._edgeManager.destroy();
    }
};

/* Gnome Shell Methods */
function init(metadata) {
}

let _panelSettings;

function enable() {
    _panelSettings = new PanelSettings();
}

function disable() {
    _panelSettings.destroy();
    _panelSettings = null;
}
