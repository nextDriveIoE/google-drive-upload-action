/* eslint-disable no-console */
const fs = require('fs');

const actions = require('@actions/core');
const { google } = require('googleapis');

const credentials = actions.getInput('credentials', { required: true });
const parentFolderId = actions.getInput('parent_folder_id', { required: true });
const target = actions.getInput('target', { required: false });
const owner = actions.getInput('owner', { required: false });
const childFolder = actions.getInput('child_folder', { required: false });
const overwrite = actions.getInput('overwrite', { required: false }) === 'true';
let filename = actions.getInput('name', { required: false });

const credentialsJSON = JSON.parse(Buffer.from(credentials, 'base64').toString());
const scopes = ['https://www.googleapis.com/auth/drive.file'];
const auth = new google.auth
    .JWT(credentialsJSON.client_email, null, credentialsJSON.private_key, scopes, owner);
const drive = google.drive({ version: 'v3', auth });

async function getUploadFolderId() {
    if (!childFolder) {
        return parentFolderId;
    }

    // Check if child folder already exists
    const { data: { files } } = await drive.files.list({
        q: `name='${childFolder}' and '${parentFolderId}' in parents and trashed=false`,
        fields: 'files(id)',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
    });

    if (files.length > 1) {
        throw new Error('More than one entry match the child folder name');
    }

    // Return existing folder ID if found
    if (files.length === 1) {
        actions.info(`Using existing folder ${childFolder} with ID ${files[0].id}`);
        return files[0].id;
    }

    // Create new folder if none exists
    const childFolderMetadata = {
        name: childFolder,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId],
    };

    const { data: { id: childFolderId } } = await drive.files.create({
        resource: childFolderMetadata,
        fields: 'id',
        supportsAllDrives: true,
    });

    actions.info(`Created new folder ${childFolder} with ID ${childFolderId}`);

    return childFolderId;
}

async function getFileId(targetFilename, folderId) {
    const { data: { files } } = await drive.files.list({
        q: `name='${targetFilename}' and '${folderId}' in parents`,
        fields: 'files(id)',
    });

    if (files.length > 1) {
        throw new Error('More than one entry match the file name');
    }
    if (files.length === 1) {
        return files[0].id;
    }

    return null;
}

async function main() {
    const uploadFolderId = await getUploadFolderId();

    actions.setOutput('folder_id', uploadFolderId);

    if (!target) {
        actions.info('No target file specified. Skipping upload.');
        return;
    }

    if (!filename) {
        filename = target.split('/').pop();
    }

    let fileId = null;

    if (overwrite) {
        fileId = await getFileId(filename, uploadFolderId);
    }

    const fileData = {
        body: fs.createReadStream(target),
    };

    let result;

    if (fileId === null) {
        if (overwrite) {
            actions.info(`File ${filename} does not exist yet. Creating it.`);
        } else {
            actions.info(`Creating file ${filename}.`);
        }
        const fileMetadata = {
            name: filename,
            parents: [uploadFolderId],
        };

        result = await drive.files.create({
            resource: fileMetadata,
            media: fileData,
            uploadType: 'multipart',
            fields: 'id',
            supportsAllDrives: true,
        });
    } else {
        actions.info(`File ${filename} already exists. Override it.`);
        result = await drive.files.update({
            fileId,
            media: fileData,
        });
    }

    const uploadedFileId = result.data.id;

    actions.setOutput('file_id', uploadedFileId);
    actions.info(`File ID: ${uploadedFileId}`);

    const fileUrl = `https://drive.google.com/file/d/${uploadedFileId}/view`;

    actions.setOutput('file_url', fileUrl);
    actions.info(`File URL: ${fileUrl}`);
}

main().catch((error) => actions.setFailed(error));
