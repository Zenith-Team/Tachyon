type URLString = string;
type ISODateString = string;
export interface GitHubRelease {
    url: URLString;
    assets_url: URLString;
    upload_url: URLString;
    html_url: URLString;
    id: number;
    author: GitHubUser;
    node_id: string;
    tag_name: string;
    target_commitish: string;
    name: string;
    draft: boolean;
    immutable: boolean;
    prerelease: boolean;
    created_at: ISODateString;
    updated_at: ISODateString;
    published_at: ISODateString;
    assets: Array<GitHubReleaseAsset>;
    tarball_url: URLString;
    zipball_url: URLString;
    body: string;
    reactions: {
        url: string;
        total_count: number;
        '+1': number;
        '-1': number;
        laugh: number;
        hooray: number;
        confused: number;
        heart: number;
        rocket: number;
        eyes: number;
    };
    mentions_count: number;
}
export interface GitHubReleaseAsset {
    url: URLString;
    id: number;
    node_id: string;
    name: string;
    label: null;
    uploader: GitHubUser;
    content_type: string;
    state: 'uploaded';
    size: number;
    digest: null;
    download_count: number;
    created_at: ISODateString;
    updated_at: ISODateString;
    browser_download_url: URLString;
}
export interface GitHubUser {
    login: string;
    id: number;
    node_id: string;
    avatar_url: URLString;
    gravatar_id: string;
    url: URLString;
    html_url: URLString;
    followers_url: URLString;
    following_url: URLString;
    gists_url: URLString;
    starred_url: URLString;
    subscriptions_url: URLString;
    organizations_url: URLString;
    repos_url: URLString;
    events_url: URLString;
    received_events_url: URLString;
    type: 'User';
    user_view_type: 'public';
    site_admin: boolean;
}
