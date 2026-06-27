"""
Synthetic multi-session fixtures for Suite A: Segment Recall.

Each FixtureConversation maps to a real Conversation row in MemoryDB.
Each PlantedFact maps to a segment whose summary we embed and store.
Each distractor is a segment we store but never query for (tests whether
search returns the right segment in the presence of nearby topics).

Queries are deliberately paraphrased to minimize lexical overlap with
segment summaries — this tests embedding-space retrieval, not string match.
"""
from dataclasses import dataclass, field
from typing import List


@dataclass
class PlantedFact:
    fact_id: str
    summary: str
    topics: List[str]
    queries: List[str]


@dataclass
class Distractor:
    summary: str
    topics: List[str]


@dataclass
class FixtureConversation:
    conv_id: str
    title: str
    planted: List[PlantedFact] = field(default_factory=list)
    distractors: List[Distractor] = field(default_factory=list)


FIXTURES: List[FixtureConversation] = [
    FixtureConversation(
        conv_id="conv-sarah-life",
        title="Catching up with Sarah",
        planted=[
            PlantedFact(
                fact_id="sarah-dog",
                summary="Sarah adopted a golden retriever named Biscuit from a shelter in Portland two months ago. She mentions the dog is very gentle and good with her nephew.",
                topics=["pets", "adoption"],
                queries=[
                    "What kind of pet does Sarah have?",
                    "Where did Sarah get her animal from?",
                    "Sarah's new companion",
                ],
            ),
            PlantedFact(
                fact_id="sarah-lactose",
                summary="Sarah discovered she's lactose intolerant after years of unexplained migraines. She switched to oat milk and the headaches mostly went away.",
                topics=["health", "diet"],
                queries=[
                    "Why did Sarah change what she drinks in her coffee?",
                    "What triggers Sarah's headaches?",
                    "Does Sarah have any food restrictions?",
                ],
            ),
            PlantedFact(
                fact_id="sarah-rome",
                summary="Sarah is studying Italian intensively because she's moving to Rome in June for a new role at a fintech startup focused on cross-border payments.",
                topics=["career", "relocation", "languages"],
                queries=[
                    "Why is Sarah learning a new language?",
                    "Where is Sarah relocating for work?",
                    "What is Sarah's upcoming career change?",
                ],
            ),
        ],
        distractors=[
            Distractor(
                summary="Sarah is debating whether to buy a second monitor for her home office or just a larger single display.",
                topics=["hardware", "workspace"],
            ),
            Distractor(
                summary="Sarah visited her parents in Ohio last weekend for Thanksgiving and mentioned the drive was exhausting.",
                topics=["family", "travel"],
            ),
            Distractor(
                summary="Sarah is reading Project Hail Mary and said she's enjoying the science in it.",
                topics=["books", "hobbies"],
            ),
        ],
    ),
    FixtureConversation(
        conv_id="conv-mike-work",
        title="Mike project updates",
        planted=[
            PlantedFact(
                fact_id="mike-db-migration",
                summary="Mike led the migration from MySQL to PostgreSQL last quarter; the cutover took three weekends and involved custom logical replication scripts he wrote in Go.",
                topics=["databases", "migration"],
                queries=[
                    "What major infrastructure change did Mike drive?",
                    "Which language did Mike use for replication tooling?",
                    "How long did Mike's database switch take?",
                ],
            ),
            PlantedFact(
                fact_id="mike-team-size",
                summary="Mike was promoted to engineering manager and now oversees a team of seven, including two senior engineers he hired from his previous company.",
                topics=["management", "team"],
                queries=[
                    "How many people report to Mike?",
                    "What is Mike's current role?",
                    "Did Mike bring anyone from his old job?",
                ],
            ),
            PlantedFact(
                fact_id="mike-oncall",
                summary="Mike strongly dislikes the current PagerDuty rotation and is pushing for a follow-the-sun model with a Singapore office once hiring there completes.",
                topics=["oncall", "process"],
                queries=[
                    "What does Mike want to change about incident response?",
                    "Which international office is Mike counting on?",
                    "Mike's opinion on the on-call schedule",
                ],
            ),
        ],
        distractors=[
            Distractor(
                summary="Mike thinks the new espresso machine in the office kitchen is much better than the old one and has been using it daily.",
                topics=["office", "coffee"],
            ),
            Distractor(
                summary="Mike watched the latest Dune movie over the weekend and said the soundtrack was the best part.",
                topics=["movies", "entertainment"],
            ),
        ],
    ),
    FixtureConversation(
        conv_id="conv-house-plans",
        title="Renovation planning",
        planted=[
            PlantedFact(
                fact_id="house-roof",
                summary="The roof needs replacing before winter; the contractor quoted $18,400 for architectural shingles and estimated four working days for the tear-off and install.",
                topics=["renovation", "roofing"],
                queries=[
                    "How much is the new covering on top of the house?",
                    "When does the top of the house need to be fixed by?",
                    "Contractor estimate for roof work",
                ],
            ),
            PlantedFact(
                fact_id="house-kitchen",
                summary="The kitchen remodel will move the fridge to the opposite wall and replace the laminate counters with honed soapstone, which the designer picked to hide water marks.",
                topics=["renovation", "kitchen"],
                queries=[
                    "What material is replacing the old counters?",
                    "Why was soapstone chosen over alternatives?",
                    "How is the kitchen layout changing?",
                ],
            ),
        ],
        distractors=[
            Distractor(
                summary="The neighbors' tree branches are overhanging the driveway and we might need to ask them to trim them back.",
                topics=["neighbors", "yard"],
            ),
            Distractor(
                summary="Property tax assessment came back higher this year; we should look into filing an appeal before the deadline.",
                topics=["taxes", "home-finance"],
            ),
            Distractor(
                summary="Considering switching the home internet to fiber since the ISP finally ran lines down the street.",
                topics=["internet", "utilities"],
            ),
        ],
    ),
    FixtureConversation(
        conv_id="conv-tech-stack",
        title="Stack decisions",
        planted=[
            PlantedFact(
                fact_id="stack-queue",
                summary="We picked NATS JetStream over Kafka for the event bus because the ops overhead was lower and the at-least-once guarantees were sufficient for our workload.",
                topics=["messaging", "architecture"],
                queries=[
                    "Which message broker did the team adopt?",
                    "Why did we reject Kafka for this project?",
                    "What handles our events?",
                ],
            ),
            PlantedFact(
                fact_id="stack-auth",
                summary="Authentication runs on WorkOS for SSO plus a thin internal service for API keys; we evaluated Auth0 but the pricing at our projected seat count was roughly three times higher.",
                topics=["auth", "vendors"],
                queries=[
                    "How is single sign-on handled?",
                    "Why didn't we go with Auth0?",
                    "Who issues our API credentials?",
                ],
            ),
            PlantedFact(
                fact_id="stack-monitoring",
                summary="Observability uses Grafana Cloud with Tempo for traces and Loki for logs; retention is set to 14 days for traces and 30 for logs to balance cost and investigation needs.",
                topics=["observability", "costs"],
                queries=[
                    "How long are our distributed traces kept?",
                    "What does the team use for log aggregation?",
                    "Observability vendor choice",
                ],
            ),
        ],
        distractors=[
            Distractor(
                summary="Engineering is split between Rust for the data plane and TypeScript for everything else, with Python scripts for one-off analytics.",
                topics=["languages", "architecture"],
            ),
            Distractor(
                summary="The team adopted trunk-based development six months ago and abandoned long-lived feature branches.",
                topics=["process", "git"],
            ),
        ],
    ),
    FixtureConversation(
        conv_id="conv-travel-log",
        title="Travel recap",
        planted=[
            PlantedFact(
                fact_id="travel-iceland",
                summary="The Iceland trip in March involved chasing the northern lights near Thingvellir and soaking in the Sky Lagoon instead of the tourist-heavy Blue Lagoon.",
                topics=["travel", "iceland"],
                queries=[
                    "Which geothermal spa did we visit?",
                    "Where did we see the aurora?",
                    "When did we go north to see the lights?",
                ],
            ),
            PlantedFact(
                fact_id="travel-food-poisoning",
                summary="I got severe food poisoning from a street cart in Bangkok on day two and spent the next 36 hours in the hotel unable to keep anything down.",
                topics=["travel", "health"],
                queries=[
                    "What went wrong on the Thailand trip?",
                    "Why did we lose time in Bangkok?",
                    "Illness during the Southeast Asia vacation",
                ],
            ),
        ],
        distractors=[
            Distractor(
                summary="The flight to Tokyo was delayed six hours due to a typhoon in the Pacific, so we ended up sleeping at LAX.",
                topics=["travel", "flights"],
            ),
            Distractor(
                summary="We're considering a diving certification in Bali next year since the visibility there is excellent most of the year.",
                topics=["travel", "diving"],
            ),
            Distractor(
                summary="Ran out of cash in a small town outside Siena and had to drive 40 minutes to find an ATM that accepted foreign cards.",
                topics=["travel", "italy"],
            ),
        ],
    ),
]


def total_planted_facts() -> int:
    return sum(len(c.planted) for c in FIXTURES)


def total_queries() -> int:
    return sum(len(f.queries) for c in FIXTURES for f in c.planted)


def total_segments() -> int:
    return sum(len(c.planted) + len(c.distractors) for c in FIXTURES)
