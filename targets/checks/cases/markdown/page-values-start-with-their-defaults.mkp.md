widget where_shown() {
    view {
        match (page.width) {
            case width.NARROW {
                @label(value = "On a phone");
            }
            case width.MEDIUM, width.WIDE {
                @label(value = "On a screen");
            }
        }
    }
}
@@@
@where_shown;
