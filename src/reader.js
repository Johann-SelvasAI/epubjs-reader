var EPUBJS = EPUBJS || {};
EPUBJS.reader = {};
EPUBJS.reader.plugins = {}; //-- Attach extra Controllers as plugins (like search?)

(function (root, $) {
    var previousReader = root.ePubReader || {};

    var ePubReader = (root.ePubReader = function (path, options) {
        return new EPUBJS.Reader(path, options);
    });

    //exports to multiple environments
    if (typeof define === "function" && define.amd) {
        //AMD
        define(function () {
            return Reader;
        });
    } else if (typeof module != "undefined" && module.exports) {
        //Node
        module.exports = ePubReader;
    }
})(window, jQuery);

EPUBJS.Reader = function (bookPath, _options) {
    var reader = this;
    var book;
    var rendition;
    var plugin;
    var $viewer = $("#viewer");
    var search = window.location.search;
    var parameters;

    this.settings = EPUBJS.core.defaults(_options || {}, {
        bookPath: bookPath,
        restore: false,
        reload: false,
        bookmarks: undefined,
        annotations: undefined,
        contained: undefined,
        bookKey: undefined,
        styles: undefined,
        sidebarReflow: false,
        history: true
    });

    // Overide options with search parameters
    if (search) {
        parameters = search.slice(1).split("&");
        parameters.forEach(function (p) {
            var split = p.split("=");
            var name = split[0];
            var value = split[1] || "";
            reader.settings[name] = decodeURIComponent(value);
        });
    }

    this.setBookKey(this.settings.bookPath); //-- This could be username + path or any unique string

    if (this.settings.restore && this.isSaved()) {
        this.applySavedSettings();
    }

    this.settings.styles = this.settings.styles || {
        fontSize: "100%"
    };

    this.book = book = new ePub(this.settings.bookPath, this.settings);

    this.offline = false;
    this.sidebarOpen = false;
    if (!this.settings.bookmarks) {
        this.settings.bookmarks = [];
    }

    if (!this.settings.annotations) {
        this.settings.annotations = [];
    }

    this.book.ready.then(this.generateLoc.bind(this)).catch(() => {
        console.log("error loading book");
    });

    this.rendition = rendition = book.renderTo("viewer", {
        ignoreClass: "annotator-hl",
        width: "100%",
        height: "100%"
    });

    rendition.on("selected", function (cfiRange, contents) {
        rendition.annotations.highlight(
            cfiRange,
            {},
            e => {
                console.log("highlight clicked", e.target);
                let tmpCfi = document.querySelector(".highlight").getAttribute("data-epubcfi");
                rendition.annotations.remove(tmpCfi, "highlight");
            },
            "highlight",
            {fill: "rgb(255, 55, 0)"}
        );
        contents.window.getSelection().removeAllRanges();
    });

    this.rendition.themes.default({
        "::selection": {
            background: "rgba(255,255,0, 0.3)"
        },
        ".epubjs-hl": {
            fill: "blue",
            "fill-opacity": "0.3",
            "mix-blend-mode": "multiply"
        }
    });

    if (this.settings.previousLocationCfi) {
        this.displayed = this.rendition.display(this.settings.previousLocationCfi);
    } else {
        this.displayed = this.rendition.display();
    }

    book.ready
        .then(
            function () {
                reader.ReaderController = EPUBJS.reader.ReaderController.call(reader, book);
                reader.SettingsController = EPUBJS.reader.SettingsController.call(reader, book);
                reader.ControlsController = EPUBJS.reader.ControlsController.call(reader, book);
                reader.SidebarController = EPUBJS.reader.SidebarController.call(reader, book);
                reader.BookmarksController = EPUBJS.reader.BookmarksController.call(reader, book);
                reader.NotesController = EPUBJS.reader.NotesController.call(reader, book);
                window.addEventListener("hashchange", this.hashChanged.bind(this), false);
                document.addEventListener("keydown", this.adjustFontSize.bind(this), false);
                this.rendition.on("keydown", this.adjustFontSize.bind(this));
                this.rendition.on("keydown", reader.ReaderController.arrowKeys.bind(this));
                this.rendition.on("selected", this.selectedRange.bind(this));
                this.rendition.on("relocated", this.onRenditionRelocated.bind(this));
            }.bind(this)
        )
        .then(
            function () {
                reader.ReaderController.hideLoader();
            }.bind(this)
        );

    // Call Plugins
    for (plugin in EPUBJS.reader.plugins) {
        if (EPUBJS.reader.plugins.hasOwnProperty(plugin)) {
            reader[plugin] = EPUBJS.reader.plugins[plugin].call(reader, book);
        }
    }

    book.loaded.metadata.then(function (meta) {
        reader.MetaController = EPUBJS.reader.MetaController.call(reader, meta);
    });

    book.loaded.navigation.then(function (navigation) {
        reader.TocController = EPUBJS.reader.TocController.call(reader, navigation);
    });

    window.addEventListener("beforeunload", this.unload.bind(this), false);

    return this;
};

EPUBJS.Reader.prototype.adjustFontSize = function (e) {
    var fontSize;
    var interval = 2;
    var PLUS = 187;
    var MINUS = 189;
    var ZERO = 48;
    var MOD = e.ctrlKey || e.metaKey;

    if (!this.settings.styles) return;

    if (!this.settings.styles.fontSize) {
        this.settings.styles.fontSize = "100%";
    }

    fontSize = parseInt(this.settings.styles.fontSize.slice(0, -1));

    if (MOD && e.keyCode == PLUS) {
        e.preventDefault();
        this.book.setStyle("fontSize", fontSize + interval + "%");
    }

    if (MOD && e.keyCode == MINUS) {
        e.preventDefault();
        this.book.setStyle("fontSize", fontSize - interval + "%");
    }

    if (MOD && e.keyCode == ZERO) {
        e.preventDefault();
        this.book.setStyle("fontSize", "100%");
    }
};

EPUBJS.Reader.prototype.addBookmark = function (cfi) {
    var present = this.isBookmarked(cfi);
    if (present > -1) return;

    this.settings.bookmarks.push(cfi);

    this.trigger("reader:bookmarked", cfi);
};

EPUBJS.Reader.prototype.removeBookmark = function (cfi) {
    var bookmark = this.isBookmarked(cfi);
    if (bookmark === -1) return;

    this.settings.bookmarks.splice(bookmark, 1);

    this.trigger("reader:unbookmarked", bookmark);
};

EPUBJS.Reader.prototype.isBookmarked = function (cfi) {
    let ret = -1;

    this.settings.bookmarks.forEach(function (cfi, index) {
        if (reader.containCfi(cfi)) {
            ret = index;
            return;
        }
    });

    return ret;
};

/*
EPUBJS.Reader.prototype.searchBookmarked = function(cfi) {
	var bookmarks = this.settings.bookmarks,
			len = bookmarks.length,
			i;

	for(i = 0; i < len; i++) {
		if (bookmarks[i]['cfi'] === cfi) return i;
	}
	return -1;
};
*/

EPUBJS.Reader.prototype.containCfi = function (cfi) {
    let start = this.cfiToPosition(this.rendition.location.start.cfi);
    let end = this.cfiToPosition(this.rendition.location.end.cfi);
    let pos = this.cfiToPosition(cfi);

    if (start !== null && end !== null && pos !== null) {
        if (pos.doc >= start.doc && pos.doc <= end.doc && pos.para >= start.para && pos.para <= end.para) {
            return true;
        }
    }

    return false;
};

EPUBJS.Reader.prototype.cfiToPosition = function (cfi) {
    try {
        let arr = cfi.split("!/");
        let reg = /(epubcfi\(\/\d\/)|(\[\w+\.\w+\])/g;
        let docPos = parseInt(arr[0].replaceAll(reg, ""));
        let suffixArr = arr[1].split("/");

        if (suffixArr.length > 2) {
            let paraPos = parseInt(suffixArr[1]);

            return {doc: docPos, para: paraPos};
        }
    } catch (e) {
        console.error(e);
    }

    return null;
};

EPUBJS.Reader.prototype.generateLoc = function () {
    let chars = 3000;

    return this.book.locations
        .generate(chars)
        .then(() => {
            console.log("locations generated", this.book.locations);
        })
        .catch(err => console.error("error generating locations", err));
};

EPUBJS.Reader.prototype.onRenditionRelocated = function (event) {
    if (event.start.location > 0) {
        let loc = `${event.start.location}/${this.book.locations.length()}`;
        let percentage =
            event.start.percentage > 0 && event.start.percentage < 1
                ? `${Math.round(event.start.percentage * 1000) / 10}%`
                : "";

        console.log(`loc: ${loc}, percentage: ${percentage}`);
    }
};

//-- Notes
EPUBJS.Reader.prototype.addNote = function (note) {
    this.settings.annotations.push(note);
};

EPUBJS.Reader.prototype.removeNote = function (note) {
    var index = this.settings.annotations.indexOf(note);
    if (index === -1) return;

    delete this.settings.annotations[index];
};

EPUBJS.Reader.prototype.clearNotes = function () {
    this.settings.annotations = [];
};

//-- Settings
EPUBJS.Reader.prototype.setBookKey = function (identifier) {
    if (!this.settings.bookKey) {
        this.settings.bookKey = "epubjsreader:" + EPUBJS.VERSION + ":" + window.location.host + ":" + identifier;
    }
    return this.settings.bookKey;
};

//-- Checks if the book setting can be retrieved from localStorage
EPUBJS.Reader.prototype.isSaved = function (bookPath) {
    var storedSettings;

    if (!localStorage) {
        return false;
    }

    storedSettings = localStorage.getItem(this.settings.bookKey);

    if (storedSettings === null) {
        return false;
    } else {
        return true;
    }
};

EPUBJS.Reader.prototype.removeSavedSettings = function () {
    if (!localStorage) {
        return false;
    }

    localStorage.removeItem(this.settings.bookKey);
};

EPUBJS.Reader.prototype.applySavedSettings = function () {
    var stored;

    if (!localStorage) {
        return false;
    }

    try {
        stored = JSON.parse(localStorage.getItem(this.settings.bookKey));
    } catch (e) {
        // parsing error of localStorage
        return false;
    }

    if (stored) {
        // Merge styles
        if (stored.styles) {
            this.settings.styles = EPUBJS.core.defaults(this.settings.styles || {}, stored.styles);
        }
        // Merge the rest
        this.settings = EPUBJS.core.defaults(this.settings, stored);
        return true;
    } else {
        return false;
    }
};

EPUBJS.Reader.prototype.saveSettings = function () {
    if (this.book) {
        this.settings.previousLocationCfi = this.rendition.currentLocation().start.cfi;
    }

    if (!localStorage) {
        return false;
    }

    localStorage.setItem(this.settings.bookKey, JSON.stringify(this.settings));
};

EPUBJS.Reader.prototype.unload = function () {
    if (this.settings.restore && localStorage) {
        this.saveSettings();
    }
};

EPUBJS.Reader.prototype.hashChanged = function () {
    var hash = window.location.hash.slice(1);
    this.rendition.display(hash);
};

EPUBJS.Reader.prototype.selectedRange = function (cfiRange) {
    var cfiFragment = "#" + cfiRange;

    // Update the History Location
    if (this.settings.history && window.location.hash != cfiFragment) {
        // Add CFI fragment to the history
        history.pushState({}, "", cfiFragment);
        this.currentLocationCfi = cfiRange;
    }
};

//-- Enable binding events to reader
RSVP.EventTarget.mixin(EPUBJS.Reader.prototype);
