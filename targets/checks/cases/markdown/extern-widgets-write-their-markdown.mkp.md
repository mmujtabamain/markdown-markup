$state {
    volume: number = 5;
}
@@@
@press(label = "Go");

@slider(value = $state.volume, label = "Volume");
