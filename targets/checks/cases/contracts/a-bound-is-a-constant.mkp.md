$state {
    max: number = 10;
}

let limit: number = 10;
let moving: number = $state.max;

record gauge {
    level: number 0..limit;
    other: number 0..moving;
}
@@@
Gauges.
