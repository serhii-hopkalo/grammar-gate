# grammar-gate domain

**Check**: one grammar check of one message, from submit (or retype) until its Verdict is shown. Each Check has an id. Only the latest Check may change the pane or the log. Answers for an older Check are dropped.

**Verdict**: the result of a Check. One of `clean`, `fix` (a corrected sentence with the changed words in `**bold**`), or `failed` (the checker did not answer, or answered outside the CLEAN/FIX format).

**Retype**: the user typing the corrected sentence back into the pane to practise. A Retype starts a new Check.

**Skip**: a message that gets no Check: a slash command, a `!` shell escape, a short reply such as "ok" or "thanks", more than 4000 characters, or Enter on an empty retype box. A Skip still ends the previous Check and closes the pane.

**Fast check**: the Jev call that starts every Check. It returns only the probability of an error. At 0.1 or lower it gates the Check: the Verdict is `clean` and the Full check does not run. Up to 0.3 it closes the pane early and the Full check still runs. It never writes a `fix`.

**Full check**: the `claude -p` call made for every Check the Fast check does not gate. Its Verdict wins over the Fast check, except that a `failed` Full check after a clean Fast check stays silent.

**Dialog pause**: the time a question dialog (AskUserQuestion) is on screen. The pane is closed for its whole length. A `fix` or `failed` Verdict that arrives during the pause opens the pane 300ms after the dialog ends. Only a `fix` takes focus. A Verdict shown before the pause is not restored.
