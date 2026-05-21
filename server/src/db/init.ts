import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { Store, LegacyBook } from '../types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', '..', 'data.json');

let store: Store = {
  users: [],
  books: [],
  pages: [],
  cartItems: [],
  orders: [],
  orderItems: [],
};

function persist(): void {
  writeFileSync(DB_PATH, JSON.stringify(store, null, 2));
}

function load(): void {
  if (existsSync(DB_PATH)) {
    const data = JSON.parse(readFileSync(DB_PATH, 'utf-8')) as Partial<Store>;
    store = {
      users: data.users ?? [],
      books: data.books ?? [],
      pages: data.pages ?? [],
      cartItems: data.cartItems ?? [],
      orders: data.orders ?? [],
      orderItems: data.orderItems ?? [],
    };
  }
}

export function getStore(): Store {
  return store;
}

export function resetStore(): void {
  store = {
    users: [],
    books: [],
    pages: [],
    cartItems: [],
    orders: [],
    orderItems: [],
  };
}

export function save(): void {
  persist();
}

export function initDb(): void {
  load();
  if (store.books.length === 0) {
    seed();
  }
}

function seed(): void {
  const books: LegacyBook[] = [
    {
      id: 'luna-star-garden',
      title: 'Luna and the Star Garden',
      author: 'AI Storybook',
      description: 'When Luna discovers a garden where fallen stars grow into flowers, she must protect it from the Storm King who wants to pluck every last light from the sky.',
      theme: 'fantasy',
      age_range: '4-7',
      cover_emoji: '\u{1F31F}',
      cover_color: '#7c3aed',
      price: 19.99,
      is_featured: 1,
      is_user_created: 0,
      created_by: null,
      created_at: new Date().toISOString(),
    },
    {
      id: 'captain-bear-submarine',
      title: "Captain Bear's Submarine Surprise",
      author: 'AI Storybook',
      description: "Captain Bear takes his crew of woodland friends on an underwater adventure to find the legendary Pearl of a Thousand Colors.",
      theme: 'adventure',
      age_range: '3-6',
      cover_emoji: '\u{1F43B}',
      cover_color: '#0891b2',
      price: 18.99,
      is_featured: 1,
      is_user_created: 0,
      created_by: null,
      created_at: new Date().toISOString(),
    },
    {
      id: 'robot-learns-to-hug',
      title: 'The Robot Who Learned to Hug',
      author: 'AI Storybook',
      description: "Bolt is the smartest robot in the factory, but he can't understand why humans keep wrapping their arms around each other. A story about friendship and feelings.",
      theme: 'friendship',
      age_range: '4-8',
      cover_emoji: '\u{1F916}',
      cover_color: '#dc2626',
      price: 19.99,
      is_featured: 1,
      is_user_created: 0,
      created_by: null,
      created_at: new Date().toISOString(),
    },
    {
      id: 'dinosaur-bakery',
      title: 'The Dinosaur Bakery',
      author: 'AI Storybook',
      description: "When a T-Rex opens a bakery, everyone is skeptical — his arms are too short! But Rexy proves that determination (and great recipes) can overcome any obstacle.",
      theme: 'humor',
      age_range: '3-6',
      cover_emoji: '\u{1F996}',
      cover_color: '#16a34a',
      price: 17.99,
      is_featured: 0,
      is_user_created: 0,
      created_by: null,
      created_at: new Date().toISOString(),
    },
    {
      id: 'cloud-painter',
      title: 'Zara the Cloud Painter',
      author: 'AI Storybook',
      description: "High above the city, Zara discovers she can paint the clouds. But when her paintings start coming to life, the sky becomes the most wonderful — and chaotic — canvas ever.",
      theme: 'imagination',
      age_range: '5-9',
      cover_emoji: '\u{1F3A8}',
      cover_color: '#f59e0b',
      price: 21.99,
      is_featured: 0,
      is_user_created: 0,
      created_by: null,
      created_at: new Date().toISOString(),
    },
    {
      id: 'brave-little-seed',
      title: 'The Brave Little Seed',
      author: 'AI Storybook',
      description: "A tiny seed is afraid of the dark underground, but discovers that sometimes you have to go through darkness to reach the light. A gentle story about growth and courage.",
      theme: 'nature',
      age_range: '2-5',
      cover_emoji: '\u{1F331}',
      cover_color: '#65a30d',
      price: 16.99,
      is_featured: 0,
      is_user_created: 0,
      created_by: null,
      created_at: new Date().toISOString(),
    },
  ];

  const allPages: Record<string, { text: string; illustration_description: string }[]> = {
    'luna-star-garden': [
      { text: 'Luna loved the night sky more than anything. Every evening, she would climb to the top of Willow Hill and count the stars until her eyes grew heavy.', illustration_description: 'A young girl with curly dark hair sitting on a grassy hilltop at twilight, gazing up at a sky full of bright stars. Fireflies float around her.' },
      { text: '"One hundred and seven... one hundred and eight..." she whispered. But tonight, something was different. A star was falling — not across the sky, but straight down, like a golden raindrop.', illustration_description: 'A brilliant golden star streaking downward through the purple night sky, leaving a shimmering trail.' },
      { text: "Luna followed the star to the old meadow behind her grandmother's house. There, nestled in the soft earth, the star had taken root. Tiny golden petals were already beginning to unfurl.", illustration_description: 'A glowing golden flower sprouting from dark rich soil in a moonlit meadow, its petals made of starlight.' },
      { text: '"A star garden!" Luna gasped. All around her, dozens of star-flowers glowed in every color — silver, gold, pale blue, and rose pink. They hummed a gentle melody together.', illustration_description: 'A magical garden of luminous flowers in silver, gold, blue, and pink, each glowing softly. The girl stands in the center, bathed in their colorful light.' },
      { text: "From that night on, Luna became the keeper of the Star Garden. And if you ever see the sky looking extra bright, it's because Luna planted a new star-flower that day.", illustration_description: 'The girl carefully watering a small star seedling with a watering can that pours liquid moonlight.' },
    ],
    'captain-bear-submarine': [
      { text: 'Captain Bear polished his brass telescope and peered at the lake. "Crew!" he announced. "Today, we go UNDER the water!" Rabbit, Fox, and little Mouse exchanged nervous glances.', illustration_description: 'A large friendly bear in a captain\'s hat looking through a telescope at a sparkling blue lake. A rabbit, fox, and tiny mouse stand behind him.' },
      { text: 'The submarine was made from a hollow oak log, sealed with beeswax and fitted with two bicycle wheels for steering. "All aboard!" Captain Bear called proudly.', illustration_description: 'A whimsical submarine made from a large hollow log with round porthole windows and a periscope on top.' },
      { text: 'Under the water, the world was magical. Schools of silver fish parted around them. A friendly turtle waved a flipper as they passed by a castle of smooth river stones.', illustration_description: 'An underwater scene: silver fish swimming past, a smiling turtle, colorful aquatic plants, and a castle made of smooth stones.' },
      { text: '"There it is!" squeaked Mouse, pressing her tiny nose against the glass. The Pearl of a Thousand Colors sat on a velvet cushion of moss, glowing with every color imaginable.', illustration_description: 'A luminous pearl resting on bright green moss on the lake floor, radiating rainbow colors.' },
      { text: 'They left the pearl where it belonged — some treasures are meant to be visited, not taken. But Captain Bear did bring back one souvenir: a perfect little shell for each member of his crew.', illustration_description: 'The four animal friends back on shore at sunset, each holding a unique colorful shell.' },
    ],
    'robot-learns-to-hug': [
      { text: "Bolt could calculate 47 trillion numbers per second. He could build a bridge from toothpicks. He could even make the perfect grilled cheese. But one thing puzzled him: hugging.", illustration_description: 'A cute round robot with big expressive digital eyes, standing in a bright kitchen holding a perfect grilled cheese sandwich.' },
      { text: '"What is the PURPOSE of hugging?" Bolt asked his friend Maya. "It doesn\'t build anything. It doesn\'t solve equations. It seems... inefficient." Maya just laughed.', illustration_description: 'A young girl with braids sitting cross-legged on the floor laughing, talking to a small robot who has a question mark on his screen-face.' },
      { text: "Maya was sick one day and couldn't come to the lab. Bolt ran every diagnostic he knew. Room temperature: optimal. Air quality: excellent. But something felt... wrong. Empty.", illustration_description: 'The robot standing alone in an empty, brightly lit laboratory, looking at an empty chair. His digital eyes look sad.' },
      { text: "When Maya came back, something happened that Bolt couldn't explain. His circuits warmed up. His gears spun a little faster. And his arms — slowly, gently — reached out.", illustration_description: 'The robot with arms slowly extending toward a smiling girl who has just walked through the door. Warm golden light fills the scene.' },
      { text: '"I think I understand now," Bolt said softly, his metal arms wrapped carefully around his best friend. "Hugging is how you say all the things numbers can\'t."', illustration_description: 'A heartwarming scene of a small robot and a girl hugging. The robot\'s chest displays a glowing pink heart.' },
    ],
    'dinosaur-bakery': [
      { text: 'Rexy had a dream. A big, delicious, frosting-covered dream. He was going to open the best bakery in Dinoville. There was just one teeny, tiny problem. Well — two teeny, tiny problems.', illustration_description: 'A cheerful green T-Rex wearing a chef hat, standing in front of a small bakery shop, looking down at his very short arms.' },
      { text: '"Your arms are too short!" laughed Triceratops. "You can\'t even reach the mixing bowl!" Rexy looked at his little arms. They wiggled. He wiggled them again. Then he smiled.', illustration_description: 'A Triceratops pointing and laughing while a T-Rex looks at his own tiny arms with a mischievous smile.' },
      { text: 'Rexy invented the Tail Whisk (patent pending), the Stomp-o-Matic Dough Kneader, and his masterpiece: the Head-First Frosting Technique. It was messy. It was magnificent.', illustration_description: 'A T-Rex using his tail to whisk batter, stomping dough flat with his feet, and dipping his head into frosting.' },
      { text: "On opening day, the line stretched around the block. Rexy's Volcano Cake erupted with chocolate lava. His Meteor Cookies left craters of flavor.", illustration_description: 'A long line of various dinosaurs outside a cute bakery with an erupting chocolate volcano cake in the display window.' },
      { text: '"How do you do it with those arms?" asked Triceratops, his mouth full of Volcano Cake. Rexy grinned. "Who needs long arms when you\'ve got a big imagination?"', illustration_description: 'The T-Rex proudly standing behind the bakery counter wearing a frosting-splattered apron. Triceratops has chocolate all over his face.' },
    ],
    'cloud-painter': [
      { text: "Zara lived on the very top floor of the tallest building in the city. So tall that on some mornings, the clouds drifted right past her bedroom window like fluffy white visitors.", illustration_description: 'A girl with paint-stained fingers looking out a high window as fluffy white clouds float past at eye level.' },
      { text: "One morning, Zara reached out with her paintbrush — the one Grandpa had given her — and touched a cloud. Where the brush swept, color bloomed: brilliant orange, like a sunset caught in cotton.", illustration_description: 'A hand holding an ornate paintbrush touching a white cloud outside a window. Vivid orange color spreads through the cloud.' },
      { text: "She painted a cloud-cat first. It stretched, yawned, and padded across the sky on soft paws. Then a cloud-dragon, which sneezed tiny rainbows.", illustration_description: 'A magical sky scene with a fluffy orange cat cloud stretching and a friendly purple dragon cloud sneezing a small rainbow.' },
      { text: "By afternoon, the sky was full of Zara's creations — cloud-butterflies, a cloud-pirate-ship, and one very grumpy cloud-octopus who kept tangling up the other clouds.", illustration_description: 'A chaotic but beautiful sky filled with colorful cloud creatures: butterflies, a pirate ship, and a grumpy purple octopus cloud.' },
      { text: "Now, every time you look up and see a cloud shaped like something wonderful, you'll know — Zara's been painting again.", illustration_description: 'The girl sitting on her windowsill at golden hour, smiling at a spectacular sunset sky filled with subtle cloud-creature shapes.' },
    ],
    'brave-little-seed': [
      { text: "Little Seed sat on top of the warm, brown earth. She could see the sunshine. She could feel the breeze. And she was NOT going underground. No way. Too dark.", illustration_description: 'A tiny seed with a cute worried face sitting on top of brown soil in a garden. Bright sunshine above.' },
      { text: '"Come on in!" called Earthworm from below. "It\'s cozy down here!" Little Seed peeked over the edge. It did look very, very dark.', illustration_description: 'A friendly pink earthworm poking out of a small hole in the soil, waving at the scared seed.' },
      { text: 'But then the rain came. Big, gentle drops that said "shhhh" as they landed. One drop pushed Little Seed to the edge. Another nudged her over. And down she went.', illustration_description: 'Soft blue raindrops falling on the garden. A tiny seed tipping over the edge of a small hole in the soil.' },
      { text: "Underground was dark, but it was also warm. And quiet. And safe. Little Seed felt herself cracking open — not breaking, but beginning. Tiny roots reached down. A tiny green stem reached up.", illustration_description: 'Cross-section of soil showing a small seed splitting open underground, with white roots growing downward and a pale green sprout pushing upward.' },
      { text: "And one bright morning, Little Seed pushed through the earth and felt the sunshine on her first two leaves. She was small. She was green. And she was the bravest flower in the whole garden.", illustration_description: 'A small bright green sprout with two tiny leaves breaking through the soil into golden morning sunshine.' },
    ],
  };

  store.books = books;
  store.pages = [];
  for (const [bookId, pages] of Object.entries(allPages)) {
    pages.forEach((page, i) => {
      store.pages.push({
        id: store.pages.length + 1,
        book_id: bookId,
        page_number: i + 1,
        text: page.text,
        illustration_description: page.illustration_description,
      });
    });
  }

  persist();
  console.log(`Seeded ${books.length} books`);
}
