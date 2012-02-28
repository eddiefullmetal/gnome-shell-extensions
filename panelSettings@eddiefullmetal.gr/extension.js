const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const Lang = imports.lang;

const Tweener = imports.ui.tweener;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const PanelMenu = imports.ui.panelMenu;

const ExtensionPath = imports.ui.extensionSystem.extensionMeta['panelSettings@eddiefullmetal.gr'].path;

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

        if(settings.autohide){
            this.isAutohide = settings.autohide;
            if(this.isAutohide){
                this._hidePanel();
            }
        }else{
            this.isAutohide = false;
        }

        this._panelEnterEventId = Main.panel.actor.connect('enter-event', Lang.bind(this, this._onPanelMouseEnter));
        this._panelLeaveEventId = Main.panel.actor.connect('leave-event', Lang.bind(this, this._onPanelMouseLeave));
        this._overviewHidingEventId = Main.overview.connect('hiding', Lang.bind(this, this._onOverviewHiding));

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
    toggleAutohide: function(){
        this.isAutohide = !this.isAutohide;
        this._settings.save({autohide:this.isAutohide});
        if(this.isAutohide){
            this._hidePanel();
        }else{
            this._showPanel();
        }
    },
    _onPanelMouseEnter: function(){
        this._pendingHideRequest = false;
        if(this.isAutohide){
            this._showPanel();
        }
    },
    _onPanelMouseLeave: function(){
        //If the overview is visible or a menu is shown do not hide the panel
        var canHide = !Main.overview.visible && Main.panel._menus._activeMenu == null;
        this._pendingHideRequest = !canHide;
        if(this.isAutohide && canHide){
            this._hidePanel();
        }
    },
    _onMenuOpenState: function(menu, open){
        if(!open && this.isAutohide && this._pendingHideRequest){
            this._hidePanel();
        }
    },
    _onOverviewHiding: function(){
        if(this.isAutohide && this._pendingHideRequest){
            this._hidePanel();
        }
    },
    _hidePanel: function(){
        Tweener.addTween(Main.panel.actor, {
            height: 1,
            opacity: 255,
            time: 0.3,
            transition: "easeOutQuad",
            onUpdate: function() {
                Main.panel.actor.set_clip(0,0,Main.panel.actor.get_width(),Main.panel.actor.get_height());
            }
        });
    },
    _showPanel: function(){
        Tweener.addTween(Main.panel.actor, {
            height: this._originalHeight,
            opacity: 255,
            time: 0.3,
            transition: "easeOutQuad",
            onComplete: function() {
                Main.panel.actor.remove_clip();
            },
            onUpdate: function() {
                Main.panel.actor.set_clip(0,0,Main.panel.actor.get_width(),Main.panel.actor.get_height());
            }
        });       
    },
    _menuAdded: function(menu){
        let eventId = menu.connect('open-state-changed', Lang.bind(this, this._onMenuOpenState));
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
        this._showPanel();
        Main.panel.actor.disconnect(this._panelEnterEventId);
        Main.panel.actor.disconnect(this._panelLeaveEventId);
        Main.overview.disconnect(this._overviewHidingEventId);

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

        this._visibilityAutohide = new PopupMenu.PopupSwitchMenuItem("Autohide");
        this._visibilityAutohide.setToggleState(this._visibilityManager.isAutohide);
        this.menu.addMenuItem(this._visibilityAutohide);

        this._visibilityAutohide.connect('activate', Lang.bind(this._visibilityManager, this._visibilityManager.toggleAutohide));
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
