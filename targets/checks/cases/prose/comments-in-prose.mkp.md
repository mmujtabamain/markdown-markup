$state {
    count: int = 3;
}
@@@
# Notes

@// a comment: nothing draws it, and Markdown out leaves it out
The count is \{$state.count},
@// a comment between two lines of one paragraph doesn't end it
and the paragraph goes on.

@if ($state.count > 0) {
  @// comments sit inside blocks too, indented like the lines around them
There is something to count.
}

\@// shown as text, because the @ is escaped
