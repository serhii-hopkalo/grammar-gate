# grammar-gate domain

**Check**: one grammar check of one message, from submit (or retype) until its Verdict is shown. Each Check has an id. Only the latest Check may change the pane or the log. Answers for an older Check are dropped.

**Verdict**: the result of a Check. One of `clean`, `fix` (a corrected sentence with the changed words in `**bold**`), or `failed` (the checker did not answer).

**Retype**: the user typing the corrected sentence back into the pane to practise. A Retype starts a new Check.

**Fast check**: the Jev call made only for a Retype. It can only say "clearly clean" or nothing. It can close the pane early but never writes a `fix`.

**Full check**: the `claude -p` call made for every Check. Its Verdict wins over the Fast check, except that a `failed` Full check after a clean Fast check stays silent.

**Dialog pause**: the time a question dialog (AskUserQuestion) is on screen. The pane is closed for its whole length. A `fix` or `failed` Verdict that arrives during the pause opens the pane 300ms after the dialog ends. Only a `fix` takes focus. A Verdict shown before the pause is not restored.
