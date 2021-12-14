EPUBJS.reader.search = {};
// 추가
EPUBJS.reader.search.doSearch = function (book, text) {
    return Promise.all(
        book.spine.spineItems.map(item =>
            item.load(book.load.bind(book)).then(item.find.bind(item, text)).finally(item.unload.bind(item))
        )
    ).then(results => Promise.resolve([].concat.apply([], results)));
};

EPUBJS.reader.plugins.SearchController = function (Book) {
    var reader = this;

    var $searchBox = $("#searchBox"),
        $searchResults = $("#searchResults"),
        $searchView = $("#searchView"),
        iframeDoc;

    var searchShown = false;

    var onShow = function () {
        query();
        searchShown = true;
        $searchView.addClass("shown");
    };

    var onHide = function () {
        searchShown = false;
        $searchView.removeClass("shown");
    };

    var query = function () {
        var q = $searchBox.val();

        if (q == "") {
            return;
        }

        $searchResults.empty();
        $searchResults.append("<li><p>Searching...</p></li>");

        EPUBJS.reader.search.doSearch(Book, text).then(function (results) {
            $searchResults.empty();

            if (results.length == 0) {
                $searchResults.append("<li><p>No Results Found</p></li>");
                return;
            }

            results.forEach(function (result) {
                var $li = $("<li></li>");
                var $item = $(
                    "<a href='" + result.cfi + "' data-cfi='" + result.cfi + "'><span>" + result.excerpt + "</span></a>"
                );

                $item.on("click", function (e) {
                    var cfi = this.getAttribute("href");
                    reader.rendition.display(cfi);
                    e.preventDefault();
                });
                $li.append($item);
                $searchResults.append($li);
            });
        });
    };

    $searchBox.on("search", function (e) {
        var q = $searchBox.val();

        //-- SearchBox is empty or cleared
        if (q == "") {
            $searchResults.empty();
            if (reader.SidebarController.getActivePanel() == "Search") {
                reader.SidebarController.changePanelTo("Toc");
            }

            $(iframeDoc).find("body").unhighlight();
            iframeDoc = false;
            return;
        }

        reader.SidebarController.changePanelTo("Search");

        e.preventDefault();
    });

    return {
        show: onShow,
        hide: onHide
    };
};
