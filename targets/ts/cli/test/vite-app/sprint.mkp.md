$state {
    open: int 0... = 2;
}
@@@
# Sprint

There are \{$state.open} tasks open.

@slider(value = $state.open, label = "Open");
