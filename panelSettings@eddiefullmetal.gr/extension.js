const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const Lang = imports.lang;

const Tweener = imports.ui.tweener;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const PanelMenu = imports.ui.panelMenu;

const ExtensionPath = imports.ui.extensionSystem.extensionMeta['panelSettings@eddiefullmetal.gr'].path;

/* Panel Visibility States */

//Visibility States
const VISIBILITY_NORMAL = -1;
const VISIBILITY_AUTOHIDE = 0;
const VISIBILITY_OVERVIEW_ONLY = 1;

/* Base State */
function VisibilityBaseState(originalPanelHeight){
    this._init(originalPanelHeight);
}

VisibilityBaseState.prototype = {
    _init: function(originalPanelHeight){
        this._originalPanelHeight = originalPanelHeight;
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
    _hidePanelNoAnim: function(){
        Main.panel.actor.set_height(1);
        Main.panel.actor.set_clip(0, 0, Main.panel.actor.get_width(), 1);
    },
    _showPanelNoAnim: function(){
        Main.panel.actor.set_height(this._originalPanelHeight);
        Main.panel.actor.remove_clip();
    },
    _hidePanel: function(){
        Tweener.addTween(Main.panel.actor, {
            height: 1,
            time: 0.3,
            transition: 'easeOutQuad',
            onUpdate: function() {
                Main.panel.actor.set_clip(0,0,Main.panel.actor.get_width(),Main.panel.actor.get_height());
            }
        });
    },
    _showPanel: function(){
        Tweener.addTween(Main.panel.actor, {
            height: this._originalPanelHeight,
            time: 0.3,
            transition: 'easeOutQuad',
            onComplete: function() {
                Main.panel.actor.remove_clip();
            },
            onUpdate: function() {
                Main.panel.actor.set_clip(0,0,Main.panel.actor.get_width(),Main.panel.actor.get_height());
            }
        });       
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
        var canHide = !Main.overview.visible && Main.panel._menus._activeMenu == null;
        this._pendingHideRequest = !canHide;
        if(canHide){
            this._hidePanel();
        }
    },
    onOverviewHiding: function(){
        this._hidePanelNoAnim();
    },
    onMenuOpenStateChanged: function(menu, open){
        if(!open && this._pendingHideRequest && !Main.overview.visible){
            this._hidePanel();
        }
    },
    destroy: function(){
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

        if(!Main.overview.visible){
            this._hidePanel();
        }
    },
    onOverviewHiding: function(){
        this._hidePanelNoAnim();
    },
    onOverviewShowing: function(){
        this._showPanelNoAnim();
    },
    destroy: function(){
        this._showPanel();
    }
}

/* Settings Manager  */
function SettingsManager(){
    this._init();
}

SettingsManager.prototype = {
    _init: function(){
        this._file = Gio.file_new_for_path(ExtensionPath + '/settings.json');
    },
    save: function(settings){
        this._file.replace_contents(JSON.stringify(settings), null, false, 0, null);
    },
    load: function(){
        if(this._file.query_exists(null)) {
            [flag, data] = this._file.load_contents(null);

            if(flag){
                return JSON.parse(data);
            }else{
                return null;
            }
        }
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
        let settings = this._settings.load();

        if(settings.visibilityState != undefined){
            this.setState(settings.visibilityState);
        }else{
            this.setState(VISIBILITY_NORMAL);
        }

        this._panelEnterEventId = Main.panel.actor.connect('enter-event', Lang.bind(this, this._onPanelMouseEnter));
        this._panelLeaveEventId = Main.panel.actor.connect('leave-event', Lang.bind(this, this._onPanelMouseLeave));
        this._overviewHidingEventId = Main.overview.connect('hiding', Lang.bind(this, this._onOverviewHiding));
        this._overviewShowingEventId = Main.overview.connect('showing', Lang.bind(this, this._onOverviewShowing));

        //Add a hook on the addMenu so that we can connect to open-state-changed events of menus added after the extension.
        this.originalAddMenuFunc = Main.panel._menus.addMenu;

        Main.panel._menus.addMenu = Lang.bind(this, function(menu, position){
            this.originalAddMenuFunc.apply(Main.panel._menus,[menu, position]);
            this._menuAdded(menu);
        });

        //Add a hook on the removeMenu so that we can disconnect from the open-state-changed event.
        this.originalRemoveMenuFunc = Main.panel._menus.removeMenu;

        Main.panel._menus.removeMenu = Lang.bind(this, function(menu){
            this.originalRemoveMenuFunc.apply(Main.panel._menus,[menu]);
            this._menuRemoved(menu);
        });

        this._menuData = new Array;

        for(let menuIndex in Main.panel._menus._menus){
            let menu = Main.panel._menus._menus[menuIndex].menu;
            this._menuAdded(menu);
        }
    },
    setState: function(visibilityState){
        this.visibilityState = visibilityState;
        this._settings.save({visibilityState:this.visibilityState});

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

        Main.panel._menus.addMenu = this.originalAddMenuFunc;
        Main.panel._menus.removeMenu = this.originalRemoveMenuFunc;

        for(let menuDataIndex in this._menuData){
            let menuData = this._menuData[menuDataIndex];
            menuData.menu.disconnect(menuData.eventId);
        }
    }
}

/* Panel Settings Button */
function PanelSettingsButton() {
    this._init();
}

PanelSettingsButton.prototype = {
    __proto__: PanelMenu.SystemStatusButton.prototype,

    _init: function() {
        PanelMenu.SystemStatusButton.prototype._init.call(this, 'system-run');

        this._settings = new SettingsManager;
        this._visibilityManager = new PanelVisibilityManager(this._settings);
        
        this._visibilityItems = new Array;
    
        this._visibilityItems[VISIBILITY_NORMAL] = new PopupMenu.PopupMenuItem("Normal");
        this._visibilityItems[VISIBILITY_NORMAL].connect('activate', Lang.bind(this, this._onVisibilityNormalItemClick));
        this.menu.addMenuItem(this._visibilityItems[VISIBILITY_NORMAL]);
        
        this._visibilityItems[VISIBILITY_AUTOHIDE] = new PopupMenu.PopupMenuItem("Autohide");
        this._visibilityItems[VISIBILITY_AUTOHIDE].connect('activate', Lang.bind(this, this._onVisibilityAutohideItemClick));
        this.menu.addMenuItem(this._visibilityItems[VISIBILITY_AUTOHIDE]);

        this._visibilityItems[VISIBILITY_OVERVIEW_ONLY] = new PopupMenu.PopupMenuItem("Overview Only");
        this._visibilityItems[VISIBILITY_OVERVIEW_ONLY].connect('activate', Lang.bind(this, this._onVisibilityOverviewOnlyItemClick));        
        this.menu.addMenuItem(this._visibilityItems[VISIBILITY_OVERVIEW_ONLY]);
        
        this._updateVisibilityState();
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
    _updateVisibilityState: function(){
        for(let index in this._visibilityItems){
            this._visibilityItems[index].setShowDot(false);
        }
        
        this._visibilityItems[this._visibilityManager.visibilityState].setShowDot(true);
    },
    _destroy: function(){
        this._visibilityManager.destroy();
    }
};

/* Gnome Shell Methods */
function init(metadata) {
}

let _indicator;

function enable() {
    _indicator = new PanelSettingsButton;
    Main.panel.addToStatusArea('settings_panel_button', _indicator);
}

function disable() {
    _indicator._destroy();
    _indicator.destroy();
}
