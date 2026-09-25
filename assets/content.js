/* ============================================================================
   The words of act two: the quiz, and the letter it unlocks.
   Edit freely. No build step: save, reload.
   (The words of act one are in index.html.)
   ========================================================================= */

window.REINA = {

  /* --------------------------------------------------------------------------
     THE QUIZ
     She taps an answer. A wrong one answers back and she taps again, so she can
     never be locked out. Four right answers is 100%, and 100% opens the letter.

     Each option is:
       { text: "what the button says",
         correct: true,               <- at least one per question
         say: "the reply if she taps this one" }

     A wrong option with no `say` uses a random line from `wrong` below.
     Two options sit side by side; four make a 2x2.
     ------------------------------------------------------------------------ */
  quiz: {
    intro: "complete this quiz for a reward",

    questions: [
      {
        ask: "who loves the other person more?",
        options: [
          { text: "Will", correct: true },
          { text: "Reina", say: "whoops, that's wrong. try again." }
        ]
      },
      {
        ask: "how many kids do we have?",
        options: [
          { text: "1" },
          { text: "2", correct: true },
          { text: "6" },
          { text: "7" }
        ]
      },
      {
        ask: "how many other bitches do you have?",
        options: [
          { text: "0", say: "be so fr", secret: true },   /* tap it `minigame.taps` times... */
          { text: "67", correct: true }
        ]
      },
      {
        ask: "who is the most beautiful girl in the world?",
        options: [
          { text: "Reina", correct: true },
          { text: "Reina", correct: true },
          { text: "Reina", correct: true },
          { text: "Reina", correct: true }
        ]
      }
    ],

    wrong: [
      "that's not it.",
      "try again.",
      "nope.",
      "hmm."
    ],

    opened: "passed <3"
  },

  /* --------------------------------------------------------------------------
     THE SECRET
     Tap "0" on the bitches question this many times and a minigame opens:
     catch the shooting stars. When it's over she goes back to that question
     and still has to answer it properly. {n} is replaced with the number.
     ------------------------------------------------------------------------ */
  minigame: {
    taps: 10,
    found: "you found a secret.",
    title: "catch the shooting stars",
    hint: "tap them before they burn out",
    start: "start",
    seconds: 30,
    result: "you caught {n}.",
    best: "best: {n}",
    again: "again",
    back: "now answer honestly"
  },

  /* --------------------------------------------------------------------------
     THE LETTER
     One string per paragraph; they arrive one after another as she reads.
     The last one is "I love you s" and then a LOT of o's: change the number
     in "o".repeat(...) to make it longer or shorter.
     ------------------------------------------------------------------------ */
  letter: {
    greeting: "Reina,",

    /* tapping this word in the greeting opens her Wikipedia page (reina.html).
       It looks like plain text: nothing tells her it can be tapped.
       set to null to turn it off */
    nameLink: { word: "Reina", href: "reina.html" },

    paragraphs: [
      "I wanted to write something down properly instead of only saying it or texting it so that way you can come back here and enjoy it and I can say a lot. Since it takes a lot of writing to describe how amazing you are.",
      "Thank you for being patient with me and working through problems with me. I can tell that you care because you actually try to address things which are really important and valuable to me.",
      "Thank you for all the times you have brought me to the airport",
      "Thank you for all the gifts you have gotten me",
      "Thank you for all the times you have paid for my food (you still owe me 1k tho lmao)",
      "Thank you for being sweet to me and baby talking me (when you’re not giving me attitude)",
      "Thank you for helping me destress when I need it",
      "Thank you for the BMW hoodie (best gift I have ever gotten in my life.)",
      "Thank you for showing your affection towards me and not being scared to do so (this is really important to me as well.)",
      "Thank you for complimenting me and making me feel more confident about myself. The longer I have known you the more you have brought me up and I think that is a very important thing for a partner.",
      "Thank you for doing risky things for me sometimes like sneaking out.",
      "Thank you for staying up for me (sometimes) even though you are just a girl with a nice soft… bed.",
      "And lastly, thank you for being so hot 😍🔥🥵❤️‍🔥🫠😮‍💨💋👀💕",
      "I love you s" + "o​".repeat(2400) + " much"   /* (​: an invisible break point, so the o's flow on from "you s" instead of jumping to a new line) */
    ],

    signoff: "always,",
    signature: "Will",

    again: "watch it again"   /* a small link at the very end. set to "" to hide it */
  },

  /* --------------------------------------------------------------------------
     THE COUNTDOWN, under the letter
     Ticks down to `until` and then rests at zero. The time is written with its
     UTC offset: -07:00 is Pacific daylight time (9pm on Oct 23 in California).
     ------------------------------------------------------------------------ */
  countdown: {
    label: "until i see you again",
    until: "2026-10-23T21:00:00-07:00",
    units: ["days", "hours", "minutes", "seconds"]
  }

};
