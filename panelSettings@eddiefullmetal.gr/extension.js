const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const Lang = imports.lang;

const Tweener = imports.ui.tweener;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const PanelMenu = imports.ui.panelMenu;
const Layout = imports.ui.layout;

const ExtensionPath = imports.ui.extensionSystem.extensionMeta['panelSettings@eddiefullmetal.gr'].path;

/* Generic Helper Classes */
function MenuHook(menuAddedCallback, menuRemovedCallback){
    this._init(menuAddedCallback, menuRemovedCallback);
}

MenuHook.prototype = {
    _init: function(menuAddedCallback, menuRemovedCallback){
        this._originalAddMenuFunc = Main.panel._menus.addMenu;
        this._originalRemoveMenuFunc = Main.panel._menus.removeMenu;
        this._menuAddedCallback = menuAddedCallback;
        this._menuRemovedCallback = menuRemovedCallback;

        Main.panel._menus.addMenu =  Lang.bind(this, function(menu, position){
            this._originalAddMenuFunc.apply(Main.panel._menus,[menu, position]);            
            this._menuAddedCallback(menu, position);
        });

        Main.panel._menus.removeMenu = Lang.bind(this, function(menu){
            this._originalRemoveMenuFunc.apply(Main.panel._menus,[menu]);         
            this._menuRemovedCallback(menu);
        });
    },
    destroy: function(){
        Main.panel._menus.addMenu = this._originalAddMenuFunc;
        Main.panel._menus.removeMenu = this._originalRemoveMenuFunc;   
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
        Main.layoutManager.addChrome(this._hotCorner.actor, {visibleInFullscreen:true})
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

/* Panel Visibility States */

//Visibility States
const VISIBILITY_NORMAL = -1;
const VISIBILITY_AUTOHIDE = 0;
const VISIBILITY_OVERVIEW_ONLY = 1;

const LAYOUT_TOP = 0;
const LAYOUT_BOTTOM = 1;

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
        if(this._actor.get_y() == this._monitor.y){
            this._actor.set_height(1);
            this._actor.set_clip(this._monitor.x, this._monitor.y, this._actor.get_width(), 1);
        } else {
            let y = this._actor.get_y() + this._actor.get_height() -1;
            this._actor.set_y(y);
        }
    },
    _showPanelNoAnim: function(){  
        this._actor.show();      
        if(this._actor.get_y() == this._monitor.y){        
            this._actor.set_height(this._originalPanelHeight);
            this._actor.remove_clip();
        } else {
            this._actor.set_y(this._monitor.height - this._actor.get_height());
        }
    },
    _hidePanel: function(){
        if(this._actor.get_y() == this._monitor.y){        
            Tweener.addTween(this._actor, {
                height: 1,
                time: 0.3,
                transition: 'easeOutQuad',
                onUpdate: Lang.bind(this, function() {
                    this._actor.set_clip(this._monitor.x, this._monitor.y, this._actor.get_width(), this._actor.get_height());
                })
            });
        } else {
            Tweener.addTween(this._actor, {
                y: this._actor.get_y() + this._actor.get_height() - 1,
                time: 0.3,
                transition: 'easeOutQuad'
            });
        }
    },
    _showPanel: function(){
        this._actor.show();
        if(this._actor.get_y() == this._monitor.y){
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
        } else {
            Tweener.addTween(this._actor, {
                y: this._monitor.height - this._actor.get_height(),
                time: 0.3,
                transition: 'easeOutQuad'
            });
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
    onOverviewShowing: function(){
        this._showPanelNoAnim();
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

        for(let menuIndex in Main.panel._menus._menus){
            let menu = Main.panel._menus._menus[menuIndex].menu;
            this._menuAdded(menu);
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

/* Panel Layout Manager */
function PanelLayoutManager(settings){
    this._init(settings);
}

PanelLayoutManager.prototype = {
    _init: function(settings){
        this._settings = settings;

        let menuAddedCallback = Lang.bind(this, this._menuAdded);
        let menuRemovedCallback = Lang.bind(this, this._menuRemoved);         

        this._menuHook = new MenuHook(menuAddedCallback, menuRemovedCallback);
        this._overviewCorner = new OverviewCorner;

        if(this._settings.settings.layoutState != undefined){
            this.setState(this._settings.settings.layoutState, false);
        }else{
            this.setState(LAYOUT_TOP, true);
        }
    },
    setState: function(state, save){
        this.layoutState = state;

        if(save){
            this._settings.settings.layoutState = this.layoutState; 
            this._settings.save();
        }

        switch(this.layoutState){
            case LAYOUT_TOP:
                Main.panel.actor.get_parent().set_y(Main.layoutManager.primaryMonitor.y);
                Main.messageTray.actor.get_parent().set_y(Main.layoutManager.primaryMonitor.height - Main.messageTray.actor.get_parent().get_height());
                this._overviewCorner.disable();
                this._arrowSide = St.Side.TOP;
                break;
            case LAYOUT_BOTTOM:
                Main.panel.actor.get_parent().set_y(Main.layoutManager.primaryMonitor.height - Main.panel.actor.get_height());
                Main.messageTray.actor.get_parent().set_y(0);
                this._overviewCorner.enable();
                this._arrowSide = St.Side.BOTTOM;
                break;
        }

        this._updateMenuArrowSide();
    },
    _updateMenuArrowSide: function(){
        for(let menuIndex in Main.panel._menus._menus){
            let menu = Main.panel._menus._menus[menuIndex].menu;
            this._menuAdded(menu);
        }
    },
    _menuAdded: function(menu){
        menu._boxPointer._arrowSide = this._arrowSide;
    },
    _menuRemoved: function(menu){
    },
    destroy: function(){
        this.setState(LAYOUT_TOP, false);
        this._menuHook.destroy();
        this._overviewCorner.destroy();
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
        this._settings.load();

        this._visibilityManager = new PanelVisibilityManager(this._settings);
        this._layoutManager = new PanelLayoutManager(this._settings);
        
        this._createVisibilityMenu();
        this._createLayoutMenu();
    },
    _createVisibilityMenu: function(){
        this._visibilityItems = new Array;

        this._panelVisibilitySubMenu = new PopupMenu.PopupSubMenuMenuItem("Visibility");
        this.menu.addMenuItem(this._panelVisibilitySubMenu);
    
        this._visibilityItems[VISIBILITY_NORMAL] = new PopupMenu.PopupMenuItem("Normal");
        this._visibilityItems[VISIBILITY_NORMAL].connect('activate', Lang.bind(this, this._onVisibilityNormalItemClick));
        this._panelVisibilitySubMenu.menu.addMenuItem(this._visibilityItems[VISIBILITY_NORMAL]);
        
        this._visibilityItems[VISIBILITY_AUTOHIDE] = new PopupMenu.PopupMenuItem("Autohide");
        this._visibilityItems[VISIBILITY_AUTOHIDE].connect('activate', Lang.bind(this, this._onVisibilityAutohideItemClick));
        this._panelVisibilitySubMenu.menu.addMenuItem(this._visibilityItems[VISIBILITY_AUTOHIDE]);

        this._visibilityItems[VISIBILITY_OVERVIEW_ONLY] = new PopupMenu.PopupMenuItem("Overview Only");
        this._visibilityItems[VISIBILITY_OVERVIEW_ONLY].connect('activate', Lang.bind(this, this._onVisibilityOverviewOnlyItemClick));        
        this._panelVisibilitySubMenu.menu.addMenuItem(this._visibilityItems[VISIBILITY_OVERVIEW_ONLY]);
        
        this._updateVisibilityState();
    },
    _createLayoutMenu: function(){
        this._panelLayoutSubMenu = new PopupMenu.PopupSubMenuMenuItem("Layout");
        this.menu.addMenuItem(this._panelLayoutSubMenu);

        this._layoutItems = new Array;

        this._layoutItems[LAYOUT_TOP] = new PopupMenu.PopupMenuItem("Top");
        this._layoutItems[LAYOUT_TOP].connect('activate', Lang.bind(this, this._onLayoutTopItemClick));
        this._panelLayoutSubMenu.menu.addMenuItem(this._layoutItems[LAYOUT_TOP]);

        this._layoutItems[LAYOUT_BOTTOM] = new PopupMenu.PopupMenuItem("Bottom");
        this._layoutItems[LAYOUT_BOTTOM].connect('activate', Lang.bind(this, this._onLayoutBottomItemClick));
        this._panelLayoutSubMenu.menu.addMenuItem(this._layoutItems[LAYOUT_BOTTOM]);

        this._updateLayoutState();
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
    _onLayoutTopItemClick: function(){
        this._layoutManager.setState(LAYOUT_TOP, true);
        this._updateLayoutState();
    },
    _onLayoutBottomItemClick: function(){
        this._layoutManager.setState(LAYOUT_BOTTOM, true);
        this._updateLayoutState();
    },
    _updateVisibilityState: function(){
        for(let index in this._visibilityItems){
            this._visibilityItems[index].setShowDot(false);
        }
        
        this._visibilityItems[this._visibilityManager.visibilityState].setShowDot(true);
    },
    _updateLayoutState: function(){
        for(let index in this._layoutItems){
            this._layoutItems[index].setShowDot(false);
        }
        
        this._layoutItems[this._layoutManager.layoutState].setShowDot(true);
    },
    destroy: function(){
        this._visibilityManager.destroy();
        this._layoutManager.destroy();
        PanelMenu.SystemStatusButton.prototype.destroy.call(this);
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
    _indicator.destroy();
    _indicator = null;
}
