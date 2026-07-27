Here's a high-quality product-design prompt you can use with Claude, GPT-5, Lovable, Bolt, v0, Cursor, or any UI generation model.

---

# Prompt: Design the Ultimate AI QA Master Agent Platform UI

You are a world-class Senior Product Designer, UX Architect, and Frontend Architect specializing in enterprise software (Linear, GitHub, Vercel, Datadog, Jira, Notion, Cursor, OpenAI Playground, Retool).

Your task is to design the **ultimate AI-native QA Automation Platform UI**, not just a dashboard.

The application will later connect to backend APIs, MCP servers, AI agents, orchestration engines, databases, GitHub, Jira, Zephyr, Confluence, Notion and multiple execution engines.

The UI should therefore be designed as a scalable enterprise application.

---

# Overall Design Goals

Design something that feels like a combination of

* GitHub
* Linear
* Cursor
* OpenAI Platform
* Datadog
* Vercel
* Notion
* Retool
* Figma Dev Mode

The UI should look modern, premium and built for power users.

Avoid looking like Jira.

---

# Design Language

Use

* Clean spacing
* Rounded cards
* Soft shadows
* Dark mode first
* Beautiful typography
* Excellent hierarchy
* Minimal visual noise
* Dense information
* Keyboard-first workflow

Support

* Light Mode
* Dark Mode

---

# Layout

Use a professional three-panel layout.

```
-------------------------------------------------------
| Left Sidebar | Main Content | Right Inspector Panel |
-------------------------------------------------------
```

The right inspector changes depending on what is selected.

Example

Selecting

* Test Case
* Execution
* Flow
* Fact
* DOM
* Action
* Agent

opens details inside the right panel.

Avoid navigation away whenever possible.

---

# Left Navigation

Use expandable tree navigation.

```
Agents

Context

Flows

Facts

Actions

DOM

Data Setup

Test Cases

Settings
```

Everything should support nesting.

---

# Agents

Agents is the intelligence layer.

```
Agents

    Executor

        Executions

            Execution #14

                Run #1

                    Test Cases

                    Logs

                    Timeline

                    AI Reasoning

                    Screenshots

                    Videos

                    Network

                    Console

                    Performance

    Healer

        Healing Queue

        Suggestions

        Approved

        Rejected

        Learning

    Context Manager

        Sources

        Clarifications

        Requests

        Fact Builder

        Embeddings

        Relationships

    Test Case Manager

        Test Cases

        Coverage Analysis

        PRs

        Reviews

        Suggestions
```

---

# Executor

Execution page should contain

Summary cards

* Passed
* Failed
* Blocked
* Running
* Skipped
* Duration
* AI Confidence
* Healing Count

Large table

Columns

* Test Name
* Flow
* Browser
* Environment
* Status
* Duration
* Retry
* AI Confidence
* Owner

Filters

Search

Environment

Browser

Tags

Status

Date

Buttons

Run

Rerun Failed

Cancel

Export

Compare Runs

Timeline View

---

Selecting a Test Case

Opens Inspector Panel

Contains

Overview

Execution History

Logs

AI Analysis

DOM Snapshot

Screenshots

Network

Video

Console

Stacktrace

Suggested Fixes

---

# Healer

AI self-healing center.

Sections

Healing Queue

Suggested Locator Fixes

Root Cause Analysis

Auto Merge Suggestions

Confidence Score

Learning History

Approve

Reject

Diff Viewer

Locator Comparison

Before vs After

---

# Context Manager

Purpose

Create the organization's knowledge graph.

Supports integrations

GitHub

Jira

Zephyr

Confluence

Notion

Google Drive

SharePoint

Slack

Local Files

REST APIs

GraphQL

OpenAPI

Database

---

Subpages

Sources

Clarifications

Requests

Facts

Relationships

Knowledge Graph

---

Clarification UI

Chat interface

AI asks

"I found multiple login flows.

Which one should become the canonical flow?"

Buttons

Accept

Reject

Merge

Answer

---

Knowledge Graph

Graph visualization

Nodes

Pages

Flows

Facts

Components

Actions

Entities

Requirements

Requirements Traceability

---

# Flows

Business hierarchy

```
Flows

    Module

        Authentication

            Login

            Registration

            Forgot Password

        Checkout

            Add Item

            Payment

            Confirmation
```

Flow page contains

Description

Risk

Priority

Coverage %

Automation %

Related Pages

Related Facts

Related Test Cases

Related Executions

Dependencies

Coverage Heatmap

---

# Facts

Fact Database

Categories

Flow Facts

Execution Facts

Page Facts

API Facts

Business Rules

Constraints

Validation Rules

Each fact has

Confidence

Source

Created By

Updated By

Related Objects

AI Generated

Human Verified

---

# Actions

Represents automation methods.

Hierarchy

```
Actions

    Login Page

        clickLogin()

        enterEmail()

        enterPassword()

        verifyToast()

        waitUntilLoaded()
```

Selecting an action opens

Source Code Viewer

Language highlighting

Version History

Usage Count

Dependencies

Related Tests

AI Explanation

Edit

History

---

# DOM

Visual representation of pages.

Hierarchy

```
DOM

    Login

    Dashboard

    Checkout
```

Selecting page

Shows

Screenshot

DOM Tree

Locator Tree

Accessibility

Visual Diff

Historical Snapshots

Element Inspector

Locator Generator

---

# Data Setup

Represents test data creation.

Example

```
User

Create

Update

Delete

Archive

Deactivate
```

Each action supports

UI

API

Database

Seed Script

Mock

Fixture

Preview

Execution History

---

# Test Cases

Main area

Professional data grid.

Columns

ID

Title

Priority

Automation

Owner

Flow

Tags

Last Run

Pass Rate

Coverage

Risk

AI Score

---

Selecting Test Case

Tabs

Overview

Steps

Executions

History

Facts

Coverage

Dependencies

Screenshots

Related Bugs

PRs

Comments

Version History

AI Suggestions

---

Test Steps

Professional editable table.

Columns

Step

Action

Expected

Data

Locator

Automation Method

Status

Comments

---

Coverage Analysis

Charts

Business Coverage

Page Coverage

Action Coverage

Requirement Coverage

Risk Coverage

Automation %

Gap Analysis

AI Recommendations

---

Pull Requests

AI creates standardized improvements.

Show

Before

After

Diff

Comments

Reviewer

Status

Approve

Reject

Merge

---

# Context Integrations

Create beautiful connection cards.

GitHub

Jira

Zephyr

Confluence

Notion

Azure DevOps

GitLab

Bitbucket

Postman

Swagger

Playwright

Cypress

Selenium

REST APIs

Each card

Status

Connected

Sync

Last Sync

Reconnect

Permissions

---

# Global Search

Universal search

Search everything

Test Cases

Executions

Pages

Flows

Facts

Actions

DOM

Agents

Users

Requirements

Keyboard Shortcut

Ctrl + K

---

# AI Copilot

Floating assistant.

Can answer

"What failed yesterday?"

"Generate checkout tests."

"Find flaky tests."

"Improve coverage."

"Explain this failure."

"Why did healing occur?"

"Create missing test cases."

---

# Notifications

Right-side notification center.

Execution completed

Healing suggestion

PR awaiting review

Context updated

Coverage decreased

Integration disconnected

---

# Dashboard

Landing page should include

Executive KPI cards

Execution Trends

Failure Heatmap

Coverage Heatmap

Recent Executions

Agent Activity

AI Insights

Flaky Tests

Top Risks

Latest PRs

Connected Sources

Pending Clarifications

Knowledge Graph Preview

---

# Common Components

Every page should support

Professional tables

Column customization

Filtering

Sorting

Grouping

Bulk Actions

Inline Editing

Pagination

Infinite Scroll

Resizable Columns

Saved Views

Export CSV

Export Excel

Copy

Duplicate

Delete

Archive

Tagging

Comments

Attachments

Activity Timeline

Audit Logs

Keyboard Shortcuts

Command Palette

Breadcrumbs

Context Menus

Right-click actions

Split View

Drawer Panels

Confirmation Dialogs

Advanced Modals

Loading Skeletons

Empty States

Error States

Success Toasts

Undo Actions

---

# UI Components

Use

DataGrid

Tree View

Graph View

Kanban

Timeline

Diff Viewer

Code Viewer

JSON Viewer

Markdown Viewer

Terminal Logs

Video Player

Screenshot Gallery

Heatmaps

Charts

Progress Rings

Tag Chips

Status Pills

Expandable Rows

Inspector Drawer

Resizable Panels

Tabbed Interface

Multi-select

Drag & Drop

Breadcrumb Navigation

---

# Technical Expectations

Design the UI as if it will later be implemented using

* React
* Next.js
* Tailwind CSS
* shadcn/ui
* Radix UI
* TanStack Table
* React Flow
* Monaco Editor
* React Query
* Framer Motion
* Zustand

All pages should be componentized, reusable, scalable, and API-driven.

---

# Output Requirements

Generate a complete product design including:

1. Overall information architecture and sitemap.
2. User flows and navigation between sections.
3. Detailed wireframes for every page.
4. Desktop-first responsive layouts.
5. Tables, forms, drawers, modals, and dialogs for each feature.
6. Empty, loading, success, and error states.
7. Component hierarchy and reusable design system.
8. Design tokens (spacing, typography, colors, icons, elevation).
9. Interaction patterns, animations, and keyboard shortcuts.
10. Example data for every screen to demonstrate realistic enterprise workflows.
11. API-ready page structures with placeholders for future backend integration.
12. Extensibility considerations for adding new AI agents, integrations, and execution engines without redesigning the platform.

The result should feel like a production-ready enterprise SaaS platform suitable for Fortune 500 QA teams, emphasizing clarity, scalability, AI-assisted workflows, and exceptional user experience rather than a simple admin dashboard.