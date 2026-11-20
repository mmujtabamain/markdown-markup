$state {
    n: int = 2;
}

let names: list<text> = ["api", "worker"];
@@@
# Indented blocks

@frame(title = "Build") {
    It passed in **4 minutes**.

    ```sh
    make
      all
    ```

        a line of code
}

@for (x in names) {
    @if (x == "api") {
        - **\{x}**, first
    } else {
        - \{x}
    }
}

@match ($state.n) {
    case 0 {
        None.
    }
    case else {
        \{$state.n} of them.
    }
}
