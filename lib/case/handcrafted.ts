/**
 * "The Fourth Course": the handcrafted case.
 *
 * SERVER ONLY. This file contains the solution. Client code must import the
 * public projection instead (see ./public.ts); tests/case/boundary.test.ts
 * fails the build if a client module ever imports this.
 *
 * The shape of the mystery, for whoever edits it:
 * - The poison was monkshood root, swapped for the horseradish in a copper
 *   dish and grated over the critic's turbot by an innocent sous chef.
 * - Two windows pin the culprit: the root left the alley after 20:31 and was
 *   already on the pass by 20:56. The alley door was used only 20:44–20:49
 *   and 20:58–21:03, so only the first trip counts.
 * - Four suspects have hard alibis for 20:44–20:49. Each alibi is also what
 *   exposes that suspect's own (unrelated) lie. The fifth, the porter, has a
 *   dish-machine log that looks like an alibi and is not.
 */
import { parseClock } from "./time";
import { VICTIM_ID, type CaseFile } from "./types";

const t = (clock: string): number => {
  const minute = parseClock(clock);
  if (minute === null) throw new Error(`Bad clock time: ${clock}`);
  return minute;
};

export const THE_FOURTH_COURSE: CaseFile = {
  id: "the-fourth-course",
  title: "The Fourth Course",
  restaurant: "Verjus",
  tagline: "Someone poisoned the critic. Five people in the kitchen had a reason to.",
  date: "Saturday 14 November",
  briefing: [
    "Saturday night at Verjus: one star, forty covers. At table seven, dining alone under the name Marsh, sits Augustin Vale, restaurant critic of the Meridian.",
    "At 21:16 his fourth course arrives: turbot, beurre blanc, fresh horseradish grated over the plate at the pass. At 21:34 he collapses. He is dead before the ambulance reaches St. Brigid's.",
    "Five people worked the kitchen that night. Each of them is hiding something, and one of them is hiding this. Question them, collect what they give away, and when you can name who, how, and why, make your accusation.",
  ],
  window: { from: t("20:00"), to: t("21:40") },

  victim: {
    id: VICTIM_ID,
    name: "Augustin Vale",
    role: "Restaurant critic, the Meridian",
    blurb: "Fifty-eight. Feared for thirty years. Booked table seven as 'A. Marsh'.",
  },

  suspects: [
    {
      id: "odile",
      name: "Odile Renard",
      short: "Odile",
      role: "Chef and owner",
      monogram: "OR",
      blurb: "Built Verjus from a bankrupt bistro. Has not taken a Saturday off in eleven years.",
      opening: "You have until the stock comes off the boil, Detective. Ask.",
      voice:
        "Imperious and exact. Short declarative sentences, the cadence of someone calling tickets. Treats the detective like a supplier who has arrived late. Never raises her voice. Dry, occasionally cutting. Proud to the point of brittleness; when cornered she goes colder, not louder.",
      secret:
        "Verjus is insolvent. During service you took a call from Calloway & Finch, insolvency practitioners, in the office. You also knew Augustin Vale well: you cooked on the same line in Lyon thirty years ago, he lent you the deposit for this building, and he came on Saturday as a favour, to write the review that would keep your doors open. A review arranged between friends would taint your star and his name, so you tell the detective he was a stranger.",
      knows: [
        "You ran the pass all evening, calling every plate, except for twelve minutes: you took a phone call in the office from 20:41 to 20:53.",
        "Table seven's turbot got the VIP flourish: instead of horseradish cream, fresh horseradish root grated over the plate at the pass at the last second. You called it at 21:11. Tomas grated it. The plate left at 21:16.",
        "The root for the flourish sits in a small copper dish by the heat lamps. You will not have a smeared dish on your pass, so between VIP tables it goes down to the dish pit to be rinsed and polished. It went down after table four's plate, around 20:40. It was back in its place, with a root in it, when you returned from the office. You did not see who returned it.",
        "A tablet above the pass photographs every plate that goes to a VIP. You keep the photos for the kitchen's reference book. Table four's turbot was photographed at 20:38 and each of table seven's courses after that. The copper dish is in the corner of every frame.",
        "At lineup (16:30) you told the entire brigade that table seven, booked as Marsh, was Augustin Vale and that he was a friend of the house. You wrote it on the lineup sheet, which hangs by the office door.",
        "Your opinions of the brigade: Tomas wants your job. Priya has some history with Vale she never discusses. Marit's 'wild' produce is suspiciously uniform. Gus has washed your pots for six years, never asked for anything, and is the one person you would trust with your keys.",
        "When you got back to the pass at 20:53 Tomas was there. A few minutes before nine he stepped away and you bumped his tickets with your own PIN until he came back a little after nine. You did not ask why.",
      ],
      sightings: [
        {
          subject: "tomas",
          place: "pass",
          from: t("20:53"),
          to: t("20:58"),
          note: "calling tickets when you came back from the office",
        },
      ],
      alibi: [
        { place: "pass", from: t("20:00"), to: t("21:34"), lie: "odile_pass" },
        { place: "dining_room", from: t("21:34"), to: t("21:40"), lie: null },
      ],
      lies: [
        {
          id: "odile_pass",
          topic: "whether she left the pass",
          says: "I did not leave my pass from the first ticket at eight until the dining room started screaming at 21:34.",
          truth: "She was in the office on the phone from 20:41 to 20:53.",
          why: "A chef who leaves her pass on a Saturday looks finished, and the call was from insolvency practitioners.",
          asserts: [
            {
              kind: "location",
              subject: "odile",
              place: "pass",
              from: t("20:00"),
              to: t("21:34"),
              object: null,
              negated: false,
            },
          ],
          breaksWith: ["phone_log"],
          admits:
            "Twelve minutes. She took a call from Calloway & Finch, insolvency practitioners, in the office at 20:41 and was back on the pass at 20:53. Verjus owes more than it earns.",
        },
        {
          id: "odile_stranger",
          topic: "whether she knew Vale",
          says: "I knew a critic was in my dining room. I did not know Augustin Vale. Critics are weather.",
          truth:
            "They cooked together in Lyon thirty years ago; he lent her the deposit for the building and came to help her.",
          why: "A friendly review arranged between old colleagues would taint her star and his reputation.",
          asserts: [
            {
              kind: "relationship",
              subject: "odile",
              place: null,
              from: null,
              to: null,
              object: VICTIM_ID,
              negated: true,
            },
          ],
          breaksWith: ["notebook", "lineup_sheet"],
          admits:
            "They stood on the same line in Lyon thirty years ago. He lent her the deposit on the building. He came to write the review that would have kept her doors open; she needed him alive.",
        },
      ],
      deflections: [
        "I do not know what that is supposed to mean, Detective, and I have a kitchen to hold together. Ask me about Saturday.",
        "That is not a question about my restaurant. Try again.",
        "I answer for my pass and my plates. Nothing else you just said is either.",
      ],
    },
    {
      id: "tomas",
      name: "Tomas Varga",
      short: "Tomas",
      role: "Sous chef",
      monogram: "TV",
      blurb:
        "Runs the pass at Odile's elbow. Fast, loud, and widely expected to have his own kitchen within the year.",
      opening: "I've told the uniformed lot everything twice. Fine. Third time. Go.",
      voice:
        "Fast and defensive, sentences that run into each other, kitchen slang, gallows humour that he regrets halfway through. He is shaken: his own hands grated the root. Swears mildly ('God', 'hell') and nothing stronger. Loyal to Priya. Resents Odile and half admires her.",
      secret:
        "You have been offered the head chef job at Brasa, a rival restaurant, by its owner Dominic Achterberg, and you plan to take Priya and two cooks with you. Odile would sack you on the spot. At 20:58 you slipped out to the alley to take Achterberg's call and came back at 21:03.",
      knows: [
        "You called and bumped tickets at the pass all evening, except from 20:58 to 21:03, when you were in the alley on the phone.",
        "You plated table seven's turbot. The ticket fired at 21:05, the fish was on the plate at 21:11, Chef called the flourish, and you picked up the root from the copper dish and grated it over the fish yourself. The runner took the plate at 21:16. You have been sick about it since.",
        "The copper dish holds the horseradish for the VIP flourish. After table four's plate, around 20:40, you sent it down to the dish pit in a bus tub, because Chef wants it polished between VIPs. Gus walked it back up himself at about ten to nine, with a root sitting in it, and set it by the lamps. You did not look at the root closely.",
        "Chef left the pass in the middle of the push, at about twenty to nine, and was gone a good ten minutes. You do not know where.",
        "The pass screen keeps a bump log: every ticket cleared carries the PIN of whoever cleared it. You think of it as your alibi.",
        "At lineup (16:30) Chef told everyone, porter included, that table seven was Augustin Vale booked as Marsh, a friend of the house, and wrote it on the lineup sheet.",
        "Three years ago Priya was a contestant on the television show The Final Plate. Vale was the guest judge and called her entremet 'a wedding cake for a divorce' on air. She went out in the semi-final and never talks about it.",
        "You did not go near the planters in the alley. You know monkshood grows there because Marit warned everyone.",
      ],
      sightings: [
        {
          subject: "gus",
          place: "pass",
          from: t("20:51"),
          to: t("20:52"),
          note: "walked the copper dish back up himself and set it by the lamps",
        },
      ],
      alibi: [
        { place: "pass", from: t("20:00"), to: t("21:34"), lie: "tomas_pass" },
        { place: "dining_room", from: t("21:34"), to: t("21:40"), lie: null },
      ],
      lies: [
        {
          id: "tomas_pass",
          topic: "whether he left the pass",
          says: "From eight o'clock until that plate went out I was on the pass. I don't get to leave.",
          truth:
            "He was in the alley from 20:58 to 21:03 taking a call about a job at a rival restaurant.",
          why: "Odile would fire him if she knew he was leaving and taking her cooks, and the alley is where the monkshood grows.",
          asserts: [
            {
              kind: "location",
              subject: "tomas",
              place: "pass",
              from: t("20:00"),
              to: t("21:16"),
              object: null,
              negated: false,
            },
          ],
          breaksWith: ["bump_log", "door_log"],
          admits:
            "He stepped out to the alley at 20:58 and was back on the pass by 21:03. It was a phone call from Dominic Achterberg of Brasa, offering him the head chef job. He did not touch the planter.",
        },
      ],
      deflections: [
        "I don't know what you're on about and I've got a brigade that hasn't slept. Ask me about the plate.",
        "Is that a real question? Ask me something about Saturday night.",
        "Mate, I grate horseradish for a living. Whatever that was, it's above my station. Next.",
      ],
    },
    {
      id: "priya",
      name: "Priya Nair",
      short: "Priya",
      role: "Pastry chef",
      monogram: "PN",
      blurb:
        "Makes the last three courses in a glass-walled corner the whole dining room can watch.",
      opening: "Sit, if you like. Mind the trays, they're still setting.",
      voice:
        "Warm, composed, exact. Thinks in grams and degrees and reaches for them when nervous. Dry humour. Protective of Tomas. Does not like being pitied, and bristles when her television appearance comes up.",
      secret:
        "Three years ago you were a contestant on The Final Plate. Augustin Vale, the guest judge, called your entremet 'a wedding cake for a divorce' on air and you went out in the semi-final. You tell people you have never met him. Separately: Tomas has been offered his own kitchen at Brasa and has asked you to come; neither of you has told Chef, so you cover for his absence from the pass.",
      knows: [
        "You were at the pastry station from eight o'clock until 21:20, when you went to the walk-in for cream. You were back by 21:25.",
        "Your station is glass-walled and looks straight across at the pass, about eleven metres of clear sightline.",
        "Table twelve had a birthday. At about quarter to nine the family filmed you through the glass, for several minutes, while you built the birthday plate with a sparkler. Their video will have the time on it.",
        "Around ten to nine you saw Gus walk up from the dish pit and put the small copper dish on the pass. Only the dish. You noticed because Gus never carries one thing; he carries stacks. He held it in both hands, then went back to the pit.",
        "Marit was missing from the cold station from about twenty to nine until a little before nine. You plated two of her crudos yourself. The dry store has a keypad that logs everyone who goes in.",
        "At 20:58 you saw Tomas step out of the alley door and at 21:03 you saw him come back with his phone in his hand. You know it was a call about the job at Brasa.",
        "At lineup (16:30) Chef announced that table seven was Augustin Vale, booked as Marsh, a friend of the house, and wrote it on the lineup sheet clipped by the office door. Nobody in the kitchen feared that review.",
      ],
      sightings: [
        {
          subject: "gus",
          place: "pass",
          from: t("20:51"),
          to: t("20:52"),
          note: "set one small copper dish on the pass, in both hands",
        },
        {
          subject: "tomas",
          place: "alley",
          from: t("20:58"),
          to: t("21:03"),
          note: "stepped out of the alley door and came back with his phone",
        },
      ],
      alibi: [
        { place: "pastry", from: t("20:00"), to: t("21:20"), lie: null },
        { place: "walk_in", from: t("21:20"), to: t("21:25"), lie: null },
        { place: "pastry", from: t("21:25"), to: t("21:40"), lie: null },
      ],
      lies: [
        {
          id: "priya_stranger",
          topic: "whether she had met Vale",
          says: "I know the byline. I've never met the man.",
          truth: "He judged her on television three years ago and humiliated her on air.",
          why: "She has spent three years being more than that one sentence.",
          asserts: [
            {
              kind: "relationship",
              subject: "priya",
              place: null,
              from: null,
              to: null,
              object: VICTIM_ID,
              negated: true,
            },
          ],
          breaksWith: ["notebook"],
          admits:
            "Three years ago, The Final Plate, semi-final. He called her entremet 'a wedding cake for a divorce' and four million people laughed. She says she never met him because she is tired of being that sentence.",
        },
        {
          id: "priya_cover",
          topic: "whether Tomas left the pass",
          says: "Tomas was at the rail calling tickets the entire time. Five to nine, nine o'clock, five past. I'd have noticed.",
          truth: "She saw him leave by the alley door at 20:58 and return at 21:03.",
          why: "They are leaving Verjus together and have not told Odile.",
          asserts: [
            {
              kind: "sighting",
              subject: "tomas",
              place: "pass",
              from: t("20:55"),
              to: t("21:05"),
              object: null,
              negated: false,
            },
          ],
          breaksWith: ["door_log", "bump_log"],
          admits:
            "He stepped out at 20:58 and was back at 21:03. It was a phone call about a job: he has been offered a kitchen of his own and has asked her to come. She was protecting a job, not a murderer.",
        },
      ],
      deflections: [
        "I'm not sure what you're asking me, Detective. I make desserts. Ask me about Saturday.",
        "That's a strange thing to say to a pastry chef. Do you have a question about the night?",
        "I measure things for a living, and that didn't weigh anything. Try me again.",
      ],
    },
    {
      id: "marit",
      name: "Marit Solheim",
      short: "Marit",
      role: "Forager and cold station",
      monogram: "MS",
      blurb:
        "Supplies the wild plants Verjus is known for, and planted the monkshood in the alley.",
      opening: "You want to know about the plant. Everyone wants to know about the plant.",
      voice:
        "Blunt, unhurried, literal. Short sentences with no decoration, the occasional botanical name. Norwegian directness: she finds lying tiring and small talk worse. Not rude, just uninterested in being liked.",
      secret:
        "About half of what you sell Odile as 'wild' and 'foraged' comes from a grower in the valley. On Saturday you spent 20:38 to 20:57 in the dry store peeling farm stickers off crates and relabelling them 'wild'. Augustin Vale had written to you last month asking where you find ramps in November. You never answered.",
      knows: [
        "You worked the cold station, by the alley door, all evening, except from 20:38 to 20:57, when you were in the dry store.",
        "You planted the monkshood (Aconitum napellus) in the alley planter nearest the bins, because Chef wanted blue. You warned the whole brigade the day it went in: the blue ones will stop your heart, do not touch them, do not let the root near a board.",
        "The linen driver photographs the alley wall, planters included, at every drop as proof of delivery. He came on Saturday evening at about half past eight.",
        "Whole, monkshood root is dark, smooth, and tapered like a small carrot; horseradish is pale and knobbly. Peeled, monkshood is white inside and would pass on a microplane under heat lamps. Horseradish bites the nose; monkshood smells of very little.",
        "Because your station is by the alley door, you saw Tomas go out to the alley at 20:58 and come back in at 21:03 with his phone in his hand.",
        "Gus keeps an old, yellowed newspaper cutting taped inside his locker door and closes the door when anyone walks past. He once cooked professionally: he holds a knife like someone properly taught.",
        "A missing plant would have been dug with something flat-edged, like a bench scraper or a dish scraper, by someone who could stand in the alley for a few minutes without anybody asking why.",
      ],
      sightings: [
        {
          subject: "tomas",
          place: "alley",
          from: t("20:58"),
          to: t("21:03"),
          note: "went out the alley door and came back with his phone in his hand",
        },
      ],
      alibi: [{ place: "cold_station", from: t("20:00"), to: t("21:40"), lie: "marit_station" }],
      lies: [
        {
          id: "marit_station",
          topic: "whether she left her station",
          says: "I was at my station, cold side, from eight until the shouting started. I do not wander.",
          truth: "She was in the dry store from 20:38 to 20:57 relabelling farmed produce as wild.",
          why: "Her livelihood depends on the word 'wild', and Vale had been asking questions about it.",
          asserts: [
            {
              kind: "location",
              subject: "marit",
              place: "cold_station",
              from: t("20:00"),
              to: t("21:34"),
              object: null,
              negated: false,
            },
          ],
          breaksWith: ["keypad_log"],
          admits:
            "Nineteen minutes in the dry store, 20:38 to 20:57, peeling farm stickers off crates and writing 'wild' on them. Half of what she sells as foraged comes from a grower in the valley. Vale had written asking where her ramps come from in November.",
        },
      ],
      deflections: [
        "I do not understand the question. Ask me about plants or about Saturday.",
        "That is not something I know anything about. Next.",
        "You are wasting your own time with that. Ask a real question.",
      ],
    },
    {
      id: "gus",
      name: "Gus Pereira",
      short: "Gus",
      role: "Kitchen porter",
      monogram: "GP",
      blurb:
        "Sixty-one. Six years at the dish pit. Nobody at Verjus has ever heard him raise his voice.",
      opening: "Come in, sir. Mind the floor, it's wet. It is always wet.",
      voice:
        "Gentle, unhurried, courteous. Calls the detective 'sir'. Speaks in plain sentences with the occasional piece of old-kitchen philosophy. Never angry, never hurried, a little sad. He deflects by being modest: he is only the porter, he only washes things.",
      secret:
        "You once owned a fourteen-table restaurant called Pereira's. In November 2011 Augustin Vale reviewed it in the Meridian ('a kitchen that has given up'; the turbot 'grey and apologetic'). It closed the following spring. You have kept the clipping taped inside your locker for fifteen years.",
      knows: [
        "You run the dish machine at the dish pit. From the pit you can see the back corridor: the dry-store door and the alley door.",
        "The dish machine logs every cycle. You believe that log makes you look like you never left.",
        "The copper dish came down to the pit in a bus tub at about 20:40 with the horseradish root in it.",
        "You saw Marit go into the dry store a little before twenty to nine. She was in there nearly twenty minutes.",
        "You saw Tomas step out of the alley door just before nine o'clock and come back a few minutes later.",
        "The bin cage in the alley opens with a fob; the porter's fob is yours.",
        "At lineup Chef told the brigade who was at table seven, and you initialled the lineup sheet.",
      ],
      sightings: [
        {
          subject: "marit",
          place: "dry_store",
          from: t("20:38"),
          to: t("20:57"),
          note: "went into the dry store and stayed nearly twenty minutes",
        },
        {
          subject: "tomas",
          place: "alley",
          from: t("20:58"),
          to: t("21:03"),
          note: "stepped out to the alley just before nine",
        },
      ],
      alibi: [{ place: "dish_pit", from: t("20:00"), to: t("21:40"), lie: "gus_pit" }],
      lies: [
        {
          id: "gus_pit",
          topic: "whether he left the dish pit",
          says: "From eight until they came running through with the news, I did not leave the dish pit. Ask the machine.",
          truth: "He was in the alley from 20:44 to 20:49 and at the pass at 20:51.",
          why: "Those seven minutes are the murder.",
          asserts: [
            {
              kind: "location",
              subject: "gus",
              place: "dish_pit",
              from: t("20:00"),
              to: t("21:34"),
              object: null,
              negated: false,
            },
          ],
          breaksWith: ["machine_log", "bin_cage", "guest_video"],
          admits:
            "He concedes only what the exhibit proves, and explains it innocently. Shown the machine log: he took the bins out at about quarter to nine for five minutes and left a rack against the cycle button so nobody would shout for plates; the bin cage's fob lock will show it. Shown the bin cage: scraps go in the food bin, that is what it is for. Shown the video: he walked the dish up himself because it was Chef's copper.",
        },
        {
          id: "gus_stranger",
          topic: "whether he knew Vale",
          says: "Chef said a name at lineup. I don't hold on to names from the dining room. I never knew the man.",
          truth:
            "Vale's review closed his restaurant in 2012 and he has kept the clipping ever since.",
          why: "It is his motive.",
          asserts: [
            {
              kind: "relationship",
              subject: "gus",
              place: null,
              from: null,
              to: null,
              object: VICTIM_ID,
              negated: true,
            },
          ],
          breaksWith: ["locker_clipping"],
          admits:
            "Pereira's had fourteen tables and his wife did the flowers. Vale came once, on a Tuesday, in the rain, and needed four hundred words to close it. He has known the name for fifteen years. But knowing a name is not the same as doing a thing about it.",
        },
        {
          id: "gus_dish_time",
          topic: "when the copper dish went back to the pass",
          says: "I rinsed the dish, put back what was in it, and sent it straight up. Twenty to nine, no later.",
          truth: "He carried it back to the pass himself at 20:51, after his trip to the alley.",
          why: "If the dish was back by 20:40, the swap happened on the pass and has nothing to do with him.",
          asserts: [
            {
              kind: "timing",
              subject: "gus",
              place: null,
              from: t("20:40"),
              to: null,
              object: "dish_returned",
              negated: false,
            },
          ],
          breaksWith: ["guest_video"],
          admits:
            "Then he had the time wrong: in the pit the clock is whatever rack you are on. He walked the dish up himself because it was Chef's copper and he would not trust it to a bus tub twice.",
        },
      ],
      deflections: [
        "I'm sorry, sir, I didn't follow that. I only wash the dishes. Ask me about Saturday.",
        "That is not something an old porter would know anything about, sir.",
        "You have lost me, sir. Ask me about the pit; the pit I understand.",
      ],
    },
  ],

  items: [
    { id: "monkshood_root", name: "monkshood root", kind: "poison" },
    { id: "heart_tablets", name: "heart tablets", kind: "poison" },
    { id: "rodent_bait", name: "rodent bait", kind: "poison" },
    { id: "turbot", name: "the turbot course", kind: "vehicle" },
    { id: "consomme", name: "the consommé", kind: "vehicle" },
    { id: "butter", name: "the bread-course butter", kind: "vehicle" },
    { id: "copper_dish", name: "the copper dish", kind: "object" },
  ],

  events: [
    { id: "dish_sent", label: "the copper dish goes down to the dish pit", at: t("20:40") },
    { id: "dish_returned", label: "the copper dish comes back to the pass", at: t("20:51") },
    { id: "course3_served", label: "the consommé reaches table seven", at: t("20:57") },
    { id: "course4_plated", label: "the turbot is plated and the root grated", at: t("21:11") },
    { id: "course4_served", label: "the turbot leaves the pass", at: t("21:16") },
    { id: "collapse", label: "Vale collapses", at: t("21:34") },
  ],

  truth: {
    movements: [
      { person: "odile", place: "pass", from: t("20:00"), to: t("20:41") },
      { person: "odile", place: "office", from: t("20:41"), to: t("20:53") },
      { person: "odile", place: "pass", from: t("20:53"), to: t("21:34") },
      { person: "odile", place: "dining_room", from: t("21:34"), to: t("21:40") },

      { person: "tomas", place: "pass", from: t("20:00"), to: t("20:58") },
      { person: "tomas", place: "alley", from: t("20:58"), to: t("21:03") },
      { person: "tomas", place: "pass", from: t("21:03"), to: t("21:34") },
      { person: "tomas", place: "dining_room", from: t("21:34"), to: t("21:40") },

      { person: "priya", place: "pastry", from: t("20:00"), to: t("21:20") },
      { person: "priya", place: "walk_in", from: t("21:20"), to: t("21:25") },
      { person: "priya", place: "pastry", from: t("21:25"), to: t("21:40") },

      { person: "marit", place: "cold_station", from: t("20:00"), to: t("20:38") },
      { person: "marit", place: "dry_store", from: t("20:38"), to: t("20:57") },
      { person: "marit", place: "cold_station", from: t("20:57"), to: t("21:40") },

      { person: "gus", place: "dish_pit", from: t("20:00"), to: t("20:44") },
      { person: "gus", place: "alley", from: t("20:44"), to: t("20:49") },
      { person: "gus", place: "dish_pit", from: t("20:49"), to: t("20:51") },
      { person: "gus", place: "pass", from: t("20:51"), to: t("20:52") },
      { person: "gus", place: "dish_pit", from: t("20:52"), to: t("21:40") },

      { person: VICTIM_ID, place: "dining_room", from: t("20:05"), to: t("21:40") },
    ],
    relationships: [
      {
        a: "odile",
        b: VICTIM_ID,
        note: "Cooked together in Lyon thirty years ago; he lent her the deposit for Verjus.",
      },
      { a: "priya", b: VICTIM_ID, note: "He judged her on The Final Plate three years ago." },
      { a: "gus", b: VICTIM_ID, note: "His 2011 review closed Pereira's." },
    ],
    possessions: [
      { person: "tomas", item: "copper_dish", from: t("20:00"), to: t("20:40") },
      { person: "gus", item: "copper_dish", from: t("20:40"), to: t("20:52") },
      { person: "tomas", item: "copper_dish", from: t("20:52"), to: t("21:34") },
    ],
  },

  methods: [
    {
      id: "root_on_turbot",
      label: "Monkshood root, grated over the turbot in place of horseradish",
      poison: "monkshood_root",
      vehicle: "turbot",
    },
    {
      id: "root_in_consomme",
      label: "Monkshood root, steeped into the consommé",
      poison: "monkshood_root",
      vehicle: "consomme",
    },
    {
      id: "tablets_in_sauce",
      label: "Heart tablets, crushed into the turbot's beurre blanc",
      poison: "heart_tablets",
      vehicle: "turbot",
    },
    {
      id: "bait_in_butter",
      label: "Rodent bait from the dry store, worked into the butter",
      poison: "rodent_bait",
      vehicle: "butter",
    },
  ],

  motives: [
    {
      id: "odile_review",
      suspect: "odile",
      label: "To stop a review she feared would cost Verjus its star",
      revealedBy: [],
    },
    {
      id: "odile_debt",
      suspect: "odile",
      label: "To be free of the money she owed him",
      revealedBy: ["phone_log"],
    },
    {
      id: "tomas_takeover",
      suspect: "tomas",
      label: "To sink Verjus and walk its brigade into a rival kitchen",
      revealedBy: ["tomas_brasa", "priya_brasa"],
    },
    {
      id: "priya_humiliation",
      suspect: "priya",
      label: "Payback for humiliating her on national television",
      revealedBy: ["notebook"],
    },
    {
      id: "marit_fraud",
      suspect: "marit",
      label: "To stop him exposing her 'wild' produce as farmed",
      revealedBy: ["keypad_log"],
    },
    {
      id: "gus_loyalty",
      suspect: "gus",
      label: "Misplaced loyalty: to protect Odile from a bad review",
      revealedBy: [],
    },
    {
      id: "gus_revenge",
      suspect: "gus",
      label: "Revenge for the review that closed his own restaurant",
      revealedBy: ["locker_clipping"],
    },
  ],

  evidence: [
    {
      id: "tox_report",
      title: "Toxicology, St. Brigid's",
      summary: "Aconitine. He was poisoned with monkshood.",
      detail:
        "Preliminary screen on Augustin Vale, drawn at 22:05. Aconitine, the alkaloid of monkshood (Aconitum napellus), at a fatal level. No sedatives, no cardiac drugs, no anticoagulants. Aconitine is fast: first symptoms ten to forty minutes after it is swallowed.",
      foundAt: null,
      facts: [{ type: "poison", item: "monkshood_root" }],
      unlock: { type: "start" },
    },
    {
      id: "ticket_t7",
      title: "Table seven's ticket",
      summary: "Every course for table seven, timed to the minute.",
      detail:
        "Kitchen copy, table 7: 'Marsh, 1 cover, tasting'. Seated 20:05. Third course, consommé, at the table 20:57. Fourth course, turbot: plated 21:11, out 21:16. No fifth course was fired. A handwritten line at the bottom: 'guest down 21:34'.",
      foundAt: "pass",
      facts: [
        { type: "timing", event: "course3_served", at: t("20:57") },
        { type: "timing", event: "course4_plated", at: t("21:11") },
        { type: "timing", event: "course4_served", at: t("21:16") },
        { type: "timing", event: "collapse", at: t("21:34") },
      ],
      unlock: { type: "start" },
    },
    {
      id: "notebook",
      title: "Vale's notebook",
      summary: "His notes on the meal, and on the people cooking it.",
      detail:
        "Black pocket notebook, found beside his plate. 'Verjus. Odile: thirty years since we shared a line in Lyon and she still salts like a dare. Consommé: clear as a bell. Turbot: redemption on a plate.' Further down: 'Pastry is N., the girl from The Final Plate. Better than I said she was. Tell her.' At the foot of the page: 'The porter. I know that face. From where?'",
      foundAt: "dining_room",
      facts: [
        { type: "relationship", a: "odile", b: VICTIM_ID, holds: true },
        { type: "relationship", a: "priya", b: VICTIM_ID, holds: true },
      ],
      unlock: { type: "start" },
    },
    {
      id: "plate_residue",
      title: "Plate residue, table seven",
      summary: "The shavings on his turbot were monkshood root, not horseradish.",
      detail:
        "Laboratory analysis of the fourth-course plate. The grated root over the turbot is Aconitum napellus: monkshood, peeled. There is no horseradish on the plate at all. The sauce, the fish, the wine glass, the butter, and what was left of the earlier courses are clean.",
      foundAt: "dining_room",
      facts: [{ type: "vehicle", item: "turbot" }],
      unlock: { type: "lead", any: ["odile_flourish", "tomas_flourish"] },
    },
    {
      id: "pass_photos",
      title: "Pass tablet photographs",
      summary: "At 20:38 the copper dish holds horseradish. By 20:56 it holds something else.",
      detail:
        "Two frames from the tablet above the pass. 20:38, table four's turbot: in the corner the copper dish holds a pale, knobbly root with a green crown. Horseradish. 20:56, table seven's consommé: the same dish in the same corner, but the root in it is dark, smooth, and tapered. Whatever was grated at 21:11 was already sitting on the pass by 20:56.",
      foundAt: "pass",
      facts: [
        {
          type: "window",
          step: "administer",
          item: "turbot",
          place: "pass",
          from: t("20:38"),
          to: t("20:56"),
        },
      ],
      unlock: { type: "lead", any: ["odile_photos"] },
    },
    {
      id: "planter",
      title: "The alley planter",
      summary: "One monkshood plant dug out, root and all, some time after 20:31.",
      detail:
        "The planter nearest the bins. One monkshood plant is gone: a clean, flat-edged cut in the soil, the blue flowers dropped behind the planter. The linen driver's proof-of-delivery photograph, stamped 20:31, shows the planter full and undisturbed. The root was taken after 20:31 and before it was grated at 21:11.",
      foundAt: "alley",
      facts: [
        {
          type: "window",
          step: "acquire",
          item: "monkshood_root",
          place: "alley",
          from: t("20:31"),
          to: t("21:11"),
        },
      ],
      unlock: { type: "lead", any: ["marit_planter"] },
    },
    {
      id: "door_log",
      title: "Alley door log",
      summary: "The back door was used twice: 20:44 to 20:49, and 20:58 to 21:03.",
      detail:
        "The alley door has an alarm contact that records every opening. Between 20:25 and 21:30 it shows two trips and nothing else. Out at 20:44, back in at 20:49. Out at 20:58, back in at 21:03. The log does not say who.",
      foundAt: "office",
      facts: [
        { type: "empty", place: "alley", from: t("20:25"), to: t("20:44") },
        { type: "empty", place: "alley", from: t("20:49"), to: t("20:58") },
        { type: "empty", place: "alley", from: t("21:03"), to: t("21:30") },
      ],
      unlock: { type: "evidence", all: ["planter"] },
    },
    {
      id: "phone_log",
      title: "Office phone log",
      summary: "Odile was on the office landline from 20:41 to 20:53.",
      detail:
        "The office landline: answered 20:41, hung up 20:53. The caller is Calloway & Finch, insolvency practitioners, who record their calls. Odile Renard's voice is on the recording for all twelve minutes. The office is up the back stairs; nobody takes that call from the pass.",
      foundAt: "office",
      facts: [
        { type: "presence", person: "odile", place: "office", from: t("20:41"), to: t("20:53") },
      ],
      unlock: { type: "lead", any: ["tomas_chef_left"] },
    },
    {
      id: "guest_video",
      title: "Table twelve's birthday video",
      summary: "Priya at her station from 20:42 to 20:51, and the copper dish coming back.",
      detail:
        "Phone video shot through the pastry-station glass by the family at table twelve, 20:42 to 20:51, unbroken. Priya Nair builds a birthday plate for the whole nine minutes. In the last seconds, in the background, the porter walks up to the pass and sets down a small copper dish. The clip's clock reads 20:51.",
      foundAt: "dining_room",
      facts: [
        { type: "presence", person: "priya", place: "pastry", from: t("20:42"), to: t("20:51") },
        { type: "timing", event: "dish_returned", at: t("20:51") },
      ],
      unlock: { type: "lead", any: ["priya_video"] },
    },
    {
      id: "keypad_log",
      title: "Dry-store keypad log",
      summary: "Marit's code: in at 20:38, out at 20:57.",
      detail:
        "The dry store opens with a personal code and logs the exit button. Code 4, Marit Solheim: in at 20:38, out at 20:57. On the floor inside: farm crates with the grower's stickers half peeled, and a marker pen. Several are freshly relabelled 'wild'.",
      foundAt: "dry_store",
      facts: [
        { type: "presence", person: "marit", place: "dry_store", from: t("20:38"), to: t("20:57") },
        { type: "motive", motive: "marit_fraud", holds: true },
      ],
      unlock: { type: "lead", any: ["gus_marit", "priya_marit"] },
    },
    {
      id: "bump_log",
      title: "Pass screen bump log",
      summary:
        "Tomas cleared tickets without a break from 20:36 to 20:57. Then seven minutes of nothing.",
      detail:
        "Every ticket that leaves the pass is cleared ('bumped') on the pass screen with a personal PIN. Tomas Varga's PIN clears a ticket every minute or two from 20:36 to 20:57. From 20:57 to 21:04 the tickets are cleared with Odile Renard's PIN instead. Tomas's PIN returns at 21:04.",
      foundAt: "pass",
      facts: [
        { type: "presence", person: "tomas", place: "pass", from: t("20:36"), to: t("20:57") },
      ],
      unlock: { type: "lead", any: ["tomas_bumps"] },
    },
    {
      id: "machine_log",
      title: "Dish machine cycle log",
      summary: "The machine never stopped. But for seven minutes nobody lifted its door.",
      detail:
        "The machine logs every wash cycle and every time its door is lifted. A cycle about every ninety seconds, all evening, exactly as the porter said. But from 20:43 to 20:50 it ran four cycles back to back with the door never lifted between them: one rack, washed four times. A rack leaned against the cycle button will do that.",
      foundAt: "dish_pit",
      facts: [],
      unlock: { type: "lead", any: ["gus_machine"] },
    },
    {
      id: "bin_cage",
      title: "Bin cage fob log",
      summary:
        "The porter's fob opened the bin cage at 20:45. A horseradish root was in the food bin.",
      detail:
        "The bin cage in the alley opens with a fob. The fob marked PORTER opened it at 20:45; it was locked again at 20:48. On top of the food-waste bin: a horseradish root, pale and knobbly, green crown still on, one side grated flat. It is the root from the 20:38 photograph.",
      foundAt: "alley",
      facts: [
        { type: "presence", person: "gus", place: "alley", from: t("20:45"), to: t("20:48") },
      ],
      unlock: { type: "lead", any: ["gus_bins"] },
    },
    {
      id: "lineup_sheet",
      title: "Lineup sheet",
      summary: "The whole brigade was told who was at table seven, and that he came as a friend.",
      detail:
        "Saturday's lineup sheet, clipped by the office door, in Odile Renard's handwriting: 'T7, booked as Marsh = AUGUSTIN VALE, the Meridian. Friend of the house. He is here to help us. Cook clean, nobody fusses.' Initialled by every member of the brigade. The porter's initials are there: G.P. Nobody who signed it had any reason to fear his review.",
      foundAt: "office",
      facts: [
        { type: "motive", motive: "odile_review", holds: false },
        { type: "motive", motive: "gus_loyalty", holds: false },
      ],
      unlock: { type: "lead", any: ["priya_lineup", "tomas_lineup"] },
    },
    {
      id: "locker_clipping",
      title: "Clipping from Gus's locker",
      summary: "Vale's 2011 review of a restaurant called Pereira's. It closed that spring.",
      detail:
        "Taped inside the door of the porter's locker, yellowed. Augustin Vale in the Meridian, November 2011: 'Pereira's: a kitchen that has given up.' One sentence is underlined twice in pen: 'The turbot arrived grey and apologetic.' Folded small behind it, a notice of closure for Pereira's, proprietor A. G. Pereira, dated the following April.",
      foundAt: null,
      facts: [
        { type: "relationship", a: "gus", b: VICTIM_ID, holds: true },
        { type: "motive", motive: "gus_revenge", holds: true },
      ],
      unlock: { type: "lead", any: ["marit_locker"] },
    },
  ],

  leads: [
    {
      id: "odile_flourish",
      suspect: "odile",
      requires: [],
      reveal:
        "Table seven's turbot got the VIP flourish: fresh root grated over the plate at the pass. The laboratory should start with what was grated onto that plate.",
    },
    {
      id: "odile_photos",
      suspect: "odile",
      requires: [],
      reveal:
        "A tablet above the pass photographs every VIP plate, and the copper dish is in the corner of every frame.",
    },
    {
      id: "tomas_flourish",
      suspect: "tomas",
      requires: [],
      reveal: "He grated the root over Vale's turbot himself and wants the shavings tested.",
    },
    {
      id: "tomas_chef_left",
      suspect: "tomas",
      requires: [],
      reveal: "Chef left the pass at about twenty to nine and was gone a good ten minutes.",
    },
    {
      id: "tomas_bumps",
      suspect: "tomas",
      requires: [],
      reveal: "The pass screen's bump log records whose PIN cleared every ticket.",
    },
    {
      id: "tomas_lineup",
      suspect: "tomas",
      requires: [],
      reveal:
        "Chef told the whole brigade at lineup that table seven was Augustin Vale, a friend of the house, and wrote it on the lineup sheet.",
    },
    {
      id: "tomas_brasa",
      suspect: "tomas",
      requires: ["bump_log"],
      reveal:
        "He has been offered the head chef job at Brasa by Dominic Achterberg and means to take cooks with him.",
    },
    {
      id: "priya_video",
      suspect: "priya",
      requires: [],
      reveal:
        "The family at table twelve filmed her through the pastry-station glass at about quarter to nine.",
    },
    {
      id: "priya_marit",
      suspect: "priya",
      requires: [],
      reveal:
        "Marit was missing from the cold station from about twenty to nine, and the dry-store keypad logs everyone who goes in.",
    },
    {
      id: "priya_lineup",
      suspect: "priya",
      requires: [],
      reveal:
        "Chef announced at lineup who was at table seven and wrote it on the lineup sheet by the office door.",
    },
    {
      id: "priya_brasa",
      suspect: "priya",
      requires: ["door_log"],
      reveal:
        "Tomas has been offered a kitchen of his own at Brasa and has asked her to come with him.",
    },
    {
      id: "marit_planter",
      suspect: "marit",
      requires: [],
      reveal:
        "The monkshood grows in the alley planter nearest the bins, and the linen driver photographs that wall at every drop.",
    },
    {
      id: "marit_locker",
      suspect: "marit",
      requires: [],
      reveal:
        "Gus keeps an old newspaper cutting taped inside his locker door and hides it when anyone passes.",
    },
    {
      id: "gus_machine",
      suspect: "gus",
      requires: [],
      reveal: "The dish machine keeps a log of every cycle.",
    },
    {
      id: "gus_marit",
      suspect: "gus",
      requires: [],
      reveal:
        "Marit went into the dry store a little before twenty to nine and stayed nearly twenty minutes.",
    },
    {
      id: "gus_bins",
      suspect: "gus",
      requires: ["machine_log"],
      reveal:
        "He took the bins out at about quarter to nine, and the bin cage's fob lock will show it.",
    },
  ],

  solution: {
    culprit: "gus",
    method: "root_on_turbot",
    motive: "gus_revenge",
    acquire: { place: "alley", at: t("20:46") },
    administer: { place: "pass", at: t("20:51") },
    narrative: [
      "For fifteen years Gus Pereira kept one newspaper clipping in his locker: Augustin Vale's review of Pereira's, the restaurant Gus owned until that review closed it. 'The turbot arrived grey and apologetic.'",
      "At lineup on Saturday, Odile told the brigade that Vale was at table seven and that his turbot would get the flourish: fresh horseradish, grated at the pass.",
      "At 20:40 the copper dish came down to the dish pit to be polished, the horseradish root still in it.",
      "At 20:43 Gus leaned a rack against the machine's cycle button so it would keep running without him. At 20:44 he went out the alley door.",
      "In the alley he dropped the horseradish in the food bin and dug a monkshood root out of Marit's planter with a dish scraper. He was back inside at 20:49.",
      "He peeled the root at the pot sink, set it in the copper dish, and at 20:51 carried the dish to the pass himself. A birthday video caught him doing it.",
      "At 21:11 Tomas, who had no idea, grated it over Vale's turbot. The plate left at 21:16. Vale collapsed at 21:34.",
    ],
    confession:
      "Grey and apologetic. He needed four hundred words, and I read them every morning for fifteen years, sir, while I put on my apron. I only wanted him to have one more turbot. I did not think about the boy who would have to grate it. For that part, and only that part, I am sorry.",
  },

  questions: [
    {
      id: "odile-know-vale",
      suspect: "odile",
      text: "Did you know the man at table seven?",
      presents: [],
    },
    {
      id: "odile-where",
      suspect: "odile",
      text: "Where were you between eight o'clock and the moment he collapsed?",
      presents: [],
    },
    {
      id: "odile-flourish",
      suspect: "odile",
      text: "What was different about table seven's turbot?",
      presents: [],
    },
    {
      id: "odile-photos",
      suspect: "odile",
      text: "Is there any record of what crossed the pass?",
      presents: [],
    },
    {
      id: "odile-dish",
      suspect: "odile",
      text: "Who handled the copper dish that night?",
      presents: [],
    },
    {
      id: "odile-brigade",
      suspect: "odile",
      text: "Who in your kitchen would want him dead?",
      presents: [],
    },
    {
      id: "odile-show-phone-log",
      suspect: "odile",
      text: "The office line was in use from 20:41 to 20:53. You told me you never left the pass.",
      presents: ["phone_log"],
    },
    {
      id: "odile-show-lineup",
      suspect: "odile",
      text: "This is your handwriting: 'Friend of the house.' You knew exactly who he was.",
      presents: ["lineup_sheet"],
    },

    {
      id: "tomas-grated",
      suspect: "tomas",
      text: "You plated the fourth course. Walk me through it.",
      presents: [],
    },
    {
      id: "tomas-where",
      suspect: "tomas",
      text: "Did you leave the pass at any point during service?",
      presents: [],
    },
    { id: "tomas-dish", suspect: "tomas", text: "Tell me about the copper dish.", presents: [] },
    {
      id: "tomas-priya",
      suspect: "tomas",
      text: "What is there between Priya Nair and Augustin Vale?",
      presents: [],
    },
    {
      id: "tomas-lineup",
      suspect: "tomas",
      text: "What did Chef tell the brigade about table seven?",
      presents: [],
    },
    {
      id: "tomas-show-bump-log",
      suspect: "tomas",
      text: "Your PIN is on every ticket until 20:57. Then nothing for seven minutes.",
      presents: ["bump_log"],
    },
    {
      id: "tomas-show-photos",
      suspect: "tomas",
      text: "Look at the copper dish in the 20:38 photograph. Now the one from 20:56.",
      presents: ["pass_photos"],
    },

    {
      id: "priya-know-vale",
      suspect: "priya",
      text: "Had you met Augustin Vale before Saturday?",
      presents: [],
    },
    {
      id: "priya-where",
      suspect: "priya",
      text: "Where were you between half past eight and nine?",
      presents: [],
    },
    {
      id: "priya-tomas",
      suspect: "priya",
      text: "Could Tomas have left the pass without you noticing?",
      presents: [],
    },
    {
      id: "priya-dish",
      suspect: "priya",
      text: "Did you see anyone near the copper dish?",
      presents: [],
    },
    {
      id: "priya-marit",
      suspect: "priya",
      text: "Was everyone at their station during the push?",
      presents: [],
    },
    {
      id: "priya-lineup",
      suspect: "priya",
      text: "Did the kitchen know who was at table seven?",
      presents: [],
    },
    {
      id: "priya-show-notebook",
      suspect: "priya",
      text: "His notebook says: 'Pastry is N., the girl from The Final Plate.'",
      presents: ["notebook"],
    },
    {
      id: "priya-show-door-log",
      suspect: "priya",
      text: "The alley door opened at 20:58 and again at 21:03. You said Tomas never left the pass.",
      presents: ["door_log"],
    },

    {
      id: "marit-monkshood",
      suspect: "marit",
      text: "The poison was aconite. You know plants. Where would it come from?",
      presents: [],
    },
    { id: "marit-where", suspect: "marit", text: "Where were you during service?", presents: [] },
    {
      id: "marit-root",
      suspect: "marit",
      text: "Could someone mistake monkshood root for horseradish?",
      presents: [],
    },
    { id: "marit-gus", suspect: "marit", text: "What do you make of Gus?", presents: [] },
    {
      id: "marit-show-keypad",
      suspect: "marit",
      text: "Your code opened the dry store at 20:38. You came out at 20:57.",
      presents: ["keypad_log"],
    },
    {
      id: "marit-show-planter",
      suspect: "marit",
      text: "One of your monkshood plants is gone. Root and all.",
      presents: ["planter"],
    },

    { id: "gus-where", suspect: "gus", text: "Where were you during service?", presents: [] },
    {
      id: "gus-know-vale",
      suspect: "gus",
      text: "Did you know who was eating at table seven?",
      presents: [],
    },
    {
      id: "gus-dish",
      suspect: "gus",
      text: "The copper dish came through your pit. When did it go back up?",
      presents: [],
    },
    {
      id: "gus-others",
      suspect: "gus",
      text: "Did you see anyone leave their station?",
      presents: [],
    },
    {
      id: "gus-show-machine-log",
      suspect: "gus",
      text: "Four cycles between 20:43 and 20:50, and the door never lifted between them.",
      presents: ["machine_log"],
    },
    {
      id: "gus-show-video",
      suspect: "gus",
      text: "This video has you setting the dish on the pass at 20:51. You told me twenty to nine.",
      presents: ["guest_video"],
    },
    {
      id: "gus-show-bin-cage",
      suspect: "gus",
      text: "Your fob opened the bin cage at 20:45. There was a half-grated horseradish root in the food bin.",
      presents: ["bin_cage"],
    },
    {
      id: "gus-show-clipping",
      suspect: "gus",
      text: "This was taped inside your locker. His review of Pereira's.",
      presents: ["locker_clipping"],
    },
  ],
};
