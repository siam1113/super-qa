# Super QA

Super QA helps teams organize product information and use AI agents for quality engineering and automation.

## Language

**Knowledge**:
Durable workspace information, including connected sources and structured product, technical, and quality records, that agents can search and use.
_Avoid_: Context

**Agent context**:
The information available to an agent while it handles a particular turn or task, including conversation history and relevant retrieved knowledge.
_Avoid_: Memory

**Agent memory**:
Durable information recorded for an agent to use across separate conversations or tasks, such as workspace preferences, decisions, workflows, or constraints.
_Avoid_: Conversation context

**Source**:
A connected or uploaded origin from which workspace knowledge is collected.
_Avoid_: Memory

**Organization member**:
A person listed in an organization independently of access to any particular app.
_Avoid_: App user, project member

**App assignment**:
An organization member's access to one app, with a role scoped to that app.
_Avoid_: Organization role, global app access

**Owner**:
An app assignment with authority to manage organization settings, create apps, credentials, memberships, and approvals.
_Avoid_: Organization-wide owner

**Admin**:
An app assignment with authority to change that app's settings, pause or resume it, and author and operate app workflows, without owner-only organization, app creation, access, credential, or approval actions.
_Avoid_: Operator

**Member**:
An app assignment with read-only app access.
_Avoid_: Viewer
