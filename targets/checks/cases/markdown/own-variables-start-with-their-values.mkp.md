widget left() {
    mut n: int = 3;
    view {
        @label(value = "\{n} left");
    }
    markdown {
        \{n} left
    }
}
@@@
@left;
