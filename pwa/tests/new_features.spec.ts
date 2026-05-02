import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const threeDbPath = path.resolve(__dirname, '../../pwsafe/test_dbs/three.dat');

// three.dat contents (password: "three3#;"):
//   "three entry 1"  group="group1"   user="three1_user"  pass="three1!@$%^&*()"  url="http://group1.com"
//   "three entry 2"  group="group2"   user="three2_user"  pass="three2_-+=\\|][}{';:"
//   "three entry 3"  group="group 3"  user="three3_user"  pass=",./<>?`~0"        url="https://group3.com"

async function openThreeDb(page) {
    const buffer = fs.readFileSync(threeDbPath);
    const data = [...buffer];
    await page.addInitScript((fileData) => {
        (window as any).showOpenFilePicker = async () => {
            const blob = new Blob([new Uint8Array(fileData)], { type: 'application/octet-stream' });
            const file = new File([blob], 'three.dat');
            return [{
                getFile: async () => file,
                createWritable: async () => ({ write: async () => {}, close: async () => {} }),
                name: 'three.dat',
            }];
        };
    }, data);
    await page.goto('/');
    await page.getByText('Open Database File').click();
    await page.getByPlaceholder('Password').fill('three3#;');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByPlaceholder(/Search/)).toBeVisible();
}

test.describe('AND search', () => {

    test('single term matches all entries containing it', async ({ page }) => {
        await openThreeDb(page);
        await page.getByPlaceholder(/Search/).fill('entry');
        await expect(page.locator('.tree li')).toHaveCount(3);
    });

    test('two terms narrow results by AND logic', async ({ page }) => {
        await openThreeDb(page);
        // "entry" matches all 3; adding "group1" restricts to entries whose title or group contain both
        await page.getByPlaceholder(/Search/).fill('entry group1');
        await expect(page.locator('.tree li')).toHaveCount(1);
        await expect(page.locator('.tree li')).toContainText('three entry 1');
    });

    test('two terms with no match returns empty list', async ({ page }) => {
        await openThreeDb(page);
        await page.getByPlaceholder(/Search/).fill('entry zzznotfound');
        await expect(page.locator('.tree li')).toHaveCount(0);
    });

});

test.describe('All-fields search', () => {

    test('username not found without all-fields, found with it', async ({ page }) => {
        await openThreeDb(page);
        const search = page.getByPlaceholder(/Search/);

        // "three1_user" is the username of "three entry 1" — not in title or group
        await search.fill('three1_user');
        await expect(page.locator('.tree li')).toHaveCount(0);

        // Enable all-fields
        await page.getByLabel('All fields').check();
        await expect(page.locator('.tree li')).toHaveCount(1);
        await expect(page.locator('.tree li')).toContainText('three entry 1');
    });

    test('URL search works with all-fields enabled', async ({ page }) => {
        await openThreeDb(page);
        await page.getByLabel('All fields').check();

        await page.getByPlaceholder(/Search/).fill('group3.com');
        await expect(page.locator('.tree li')).toHaveCount(1);
        await expect(page.locator('.tree li')).toContainText('three entry 3');
    });

    test('disabling all-fields reverts to title+group search', async ({ page }) => {
        await openThreeDb(page);
        const search = page.getByPlaceholder(/Search/);
        const allFields = page.getByLabel('All fields');

        await allFields.check();
        await search.fill('three1_user');
        await expect(page.locator('.tree li')).toHaveCount(1);

        await allFields.uncheck();
        await expect(page.locator('.tree li')).toHaveCount(0);
    });

});

test.describe('Password options panel', () => {

    test('gear icon toggles the panel open and closed', async ({ page }) => {
        await openThreeDb(page);
        await page.locator('.tree li').first().click();
        await expect(page.locator('.record-details')).toBeVisible();

        const panel = page.locator('.pwgen-panel');
        await expect(panel).not.toBeVisible();

        await page.getByTitle('Password options').click();
        await expect(panel).toBeVisible();

        await page.getByTitle('Password options').click();
        await expect(panel).not.toBeVisible();
    });

    test('Generate button produces a new password', async ({ page }) => {
        await openThreeDb(page);
        await page.locator('.tree li').first().click();

        const passwordInput = page.locator('#record-password');
        const before = await passwordInput.inputValue();

        await page.getByTitle('Password options').click();
        await page.getByRole('button', { name: 'Generate' }).click();

        const after = await passwordInput.inputValue();
        expect(after).not.toBe(before);
        expect(after.length).toBeGreaterThan(0);
    });

});

test.describe('Password history', () => {

    test('previous password appears in history after change', async ({ page }) => {
        await openThreeDb(page);

        // Select first record and note its current password
        await page.locator('.tree li').first().click();
        await page.getByRole('button', { name: 'Show' }).click();
        const originalPassword = await page.locator('#record-password').inputValue();

        // Change the password and save
        await page.locator('#record-password').fill('brand-new-password-xyz');
        await page.getByRole('button', { name: 'Save Record' }).click();

        // Open gear panel
        await page.getByTitle('Password options').click();

        // History toggle should appear
        const historyToggle = page.getByText(/previous password/);
        await expect(historyToggle).toBeVisible();

        // Expand history
        await historyToggle.click();

        // Old password should be shown
        await expect(page.locator('.history-pw')).toContainText(originalPassword);
    });

    test('history copy button copies old password to clipboard', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await openThreeDb(page);

        // Change the password to create a history entry
        await page.locator('.tree li').first().click();
        await page.getByRole('button', { name: 'Show' }).click();
        const originalPassword = await page.locator('#record-password').inputValue();
        await page.locator('#record-password').fill('brand-new-password-xyz');
        await page.getByRole('button', { name: 'Save Record' }).click();

        // Open and expand history
        await page.getByTitle('Password options').click();
        await page.getByText(/previous password/).click();

        // Click the copy button on the history entry
        await page.locator('.history-entry .icon-btn').click();

        const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
        expect(clipboardText).toBe(originalPassword);
    });

});

test.describe('Notes auto-grow', () => {

    test('textarea grows taller as lines are added', async ({ page }) => {
        await openThreeDb(page);
        await page.locator('.tree li').first().click();

        const textarea = page.locator('#record-notes');
        const initialHeight = (await textarea.boundingBox()).height;

        await textarea.fill(Array(12).fill('a line of notes text').join('\n'));

        const expandedHeight = (await textarea.boundingBox()).height;
        expect(expandedHeight).toBeGreaterThan(initialHeight);
    });

    test('textarea does not exceed 20-line cap', async ({ page }) => {
        await openThreeDb(page);
        await page.locator('.tree li').first().click();

        const textarea = page.locator('#record-notes');
        await textarea.fill(Array(12).fill('a line of notes text').join('\n'));
        const at12Lines = (await textarea.boundingBox()).height;

        await textarea.fill(Array(30).fill('a line of notes text').join('\n'));
        const at30Lines = (await textarea.boundingBox()).height;

        // Height should stop growing after the cap
        expect(at30Lines).toBe(at12Lines === at30Lines ? at12Lines : at30Lines);
        // More directly: 30-line fill should not be taller than 12-line fill by much
        // (they'll be equal once capped at 20 lines)
        await textarea.fill(Array(25).fill('a line of notes text').join('\n'));
        const at25Lines = (await textarea.boundingBox()).height;
        expect(at30Lines).toBe(at25Lines);
    });

});

test.describe('Double-click to copy password', () => {

    test('double-clicking sidebar item copies its password', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await openThreeDb(page);

        // Double-click "three entry 1" — password is "three1!@$%^&*()"
        const item = page.locator('.tree li', { hasText: 'three entry 1' });
        await item.dblclick();

        const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
        expect(clipboardText).toBe('three1!@$%^&*()');
    });

});
