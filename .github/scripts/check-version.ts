import packageJson from '../../package.json';

const REGISTRY_URL = 'https://npm.pkg.github.com';

const getPublishedVersion = async (packageName: string): Promise<string | null> => {
  const token = process.env.READER_TOKEN;

  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('READER_TOKEN environment variable is not set.');
  }

  const response = await fetch(`${REGISTRY_URL}/${packageName}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch package info: ${response.status.toString()} ${response.statusText}`);
  }

  const data: unknown = await response.json();

  if (
    typeof data !== 'object' ||
    data === null ||
    !('dist-tags' in data) ||
    typeof data['dist-tags'] !== 'object' ||
    data['dist-tags'] === null ||
    !('latest' in data['dist-tags']) ||
    typeof data['dist-tags'].latest !== 'string'
  ) {
    throw new Error('Unexpected response format from registry.');
  }

  return data['dist-tags'].latest;
};

const parseVersion = (version: string): [number, number, number] => {
  const parts = version.split('.').map(Number);

  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p) || p < 0)) {
    throw new Error(`Invalid semver version: "${version}"`);
  }

  return parts as [number, number, number];
};

const isNewer = (local: string, published: string): boolean => {
  const [localMajor, localMinor, localPatch] = parseVersion(local);
  const [pubMajor, pubMinor, pubPatch] = parseVersion(published);

  if (localMajor !== pubMajor) {
    return localMajor > pubMajor;
  }

  if (localMinor !== pubMinor) {
    return localMinor > pubMinor;
  }

  return localPatch > pubPatch;
};

const main = async (): Promise<void> => {
  const localVersion: string = packageJson.version;
  const publishedVersion = await getPublishedVersion(packageJson.name);

  console.info(`Local version: ${localVersion}`);
  console.info(`Published version: ${publishedVersion ?? 'none (not published)'}`);

  if (publishedVersion === null) {
    console.info(`\nNo published version found. Proceeding with first publish of ${localVersion}.`);

    return;
  }

  if (localVersion === publishedVersion) {
    throw new Error(`Version ${localVersion} is already published. Bump the version in package.json.`);
  }

  if (!isNewer(localVersion, publishedVersion)) {
    throw new Error(
      `Local version ${localVersion} is lower than published version ${publishedVersion}. Should you have rebased on main?`,
    );
  }

  console.info(`\nVersion ${localVersion} is newer than ${publishedVersion}. Proceeding with publish.`);
};

await main();
