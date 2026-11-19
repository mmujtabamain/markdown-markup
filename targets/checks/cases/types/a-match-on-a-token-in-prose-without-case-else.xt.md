token neg_shade: number { DIM, BRIGHT }

tokens t {
    neg_shade.DIM = 1;
    neg_shade.BRIGHT = 2;
}
@@@
@match (neg_shade.DIM) {
case neg_shade.DIM {
dim
}
case neg_shade.BRIGHT {
bright
}
}
