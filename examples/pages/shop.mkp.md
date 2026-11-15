//@about One item in the basket.
record item {
    name: text[1...];
    price: int 0...;
}

//@about What the page tells the app.
extern shop {
    fn checkout(total: number, count: number);
}

//@about The basket, and how much the reader means to spend.
$state {
    items: list<item> = [
        item { name = "Tea", price = 12 },
        item { name = "Honey", price = 18 },
        item { name = "Bread", price = 6 },
    ];
    budget: int 0..100 = 60;
    orders: int = 0;

    require "the basket fits the budget" {
        return items.map(fn(i) { return i.price; }).sum().or(0) <= budget;
    }
}

let total: number = $state.items.map(fn(i) { return i.price; }).sum().or(0);

//@about One row of the basket, with a button that takes it out.
widget basket_row(name: text, price: number) {
    event remove();

    view {
        @row(gap = space.S, align = align.CENTER) {
            @label(value = "\{name}: \{price} €");
            @press(label = "Remove \{name}", click = fn() { invoke remove(); });
        }
    }

    markdown {
        - \{name}: \{price} €
    }
}
@@@
# Shop

The basket holds \{$state.items.len()} items for \{total} € of a \{$state.budget} € budget.

@mut for (i in $state.items) {
@if (let x: item = i) {
@basket_row(name = x.name, price = x.price, remove = fn() { $state.items.remove(x); });
}
}

@slider(value = $state.budget, label = "Budget", range = 0..100);

@press(label = "Check out", click = fn() {
    $state.orders = $state.orders + 1;
    shop.checkout(total, $state.items.len());
});

Orders placed: \{$state.orders}.
