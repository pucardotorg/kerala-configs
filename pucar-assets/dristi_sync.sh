
#!/bin/bash

# Script to sync code from source GitHub repo to destination repo based on a tag
# Creates a new branch in destination repo based on the tag name

# Exit on any error
set -e

# Default values
WORKSPACE="/tmp/dristi-sync"
SOURCE_BRANCH="main"
DEST_BRANCH_PREFIX="dristi_sync"

# Function to display usage
usage() {
    echo "Usage: $0 -s SOURCE_REPO -t TAG -d DEST_REPO [-w WORKSPACE] [-b SOURCE_BRANCH] [-p DEST_BRANCH_PREFIX]"
    echo
    echo "Required arguments:"
    echo "  -s SOURCE_REPO     Source GitHub repository URL"
    echo "  -t TAG             Tag to pull from source repository"
    echo "  -d DEST_REPO       Destination GitHub repository URL"
    echo
    echo "Optional arguments:"
    echo "  -w WORKSPACE       Working directory (default: /tmp/github-sync)"
    echo "  -b SOURCE_BRANCH   Source branch to use (default: main)"
    echo "  -p PREFIX          Destination branch prefix (default: sync)"
    echo
    exit 1
}

# Parse command line arguments
while getopts "s:t:d:w:b:p:h" opt; do
    case $opt in
        s) SOURCE_REPO="$OPTARG";;
        t) TAG="$OPTARG";;
        d) DEST_REPO="$OPTARG";;
        w) WORKSPACE="$OPTARG";;
        b) SOURCE_BRANCH="$OPTARG";;
        p) DEST_BRANCH_PREFIX="$OPTARG";;
        h) usage;;
        \?) echo "Invalid option: -$OPTARG" >&2; usage;;
    esac
done

# Validate required parameters
if [ -z "$SOURCE_REPO" ] || [ -z "$TAG" ] || [ -z "$DEST_REPO" ]; then
    echo "Error: Missing required parameters"
    usage
fi

# Create clean workspace
echo "Creating workspace directory: $WORKSPACE"
rm -rf "$WORKSPACE"
mkdir -p "$WORKSPACE"
cd "$WORKSPACE"

# Clone source repository
echo "Cloning source repository..."
git clone "$SOURCE_REPO" source-repo
cd source-repo

# Verify tag exists
if ! git tag | grep -q "^$TAG$"; then
    echo "Error: Tag '$TAG' not found in source repository"
    exit 1
fi

# Checkout specific tag
echo "Checking out tag: $TAG"
git checkout "$TAG"

# Clone destination repository
echo "Cloning destination repository..."
cd "$WORKSPACE"
git clone "$DEST_REPO" dest-repo
cd dest-repo

# Configure git user if not already configured
if [ -z "$(git config --get user.email)" ]; then
    git config user.email "github-sync@example.com"
    git config user.name "GitHub Sync Script"
fi

# Create sanitized branch name from tag
# Replace any characters that aren't alphanumeric, hyphen, or underscore with hyphen
SANITIZED_TAG=$(echo "$TAG" | sed 's/[^a-zA-Z0-9_-]/-/g')
NEW_BRANCH="${DEST_BRANCH_PREFIX}/${SANITIZED_TAG}"

# Check if branch already exists
if git show-ref --verify --quiet "refs/remotes/origin/$NEW_BRANCH"; then
    echo "Warning: Branch $NEW_BRANCH already exists in remote"
    # Generate unique branch name by appending timestamp
    TIMESTAMP=$(date +%Y%m%d%H%M%S)
    NEW_BRANCH="${NEW_BRANCH}-${TIMESTAMP}"
    echo "Using unique branch name: $NEW_BRANCH"
fi

# Create and checkout new branch from current main/master
echo "Creating new branch: $NEW_BRANCH"
git checkout -b "$NEW_BRANCH"

# Remove all files except .git
echo "Cleaning destination repository..."
find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +

# Copy files from source to destination
echo "Copying files from source to destination..."
cp -r "$WORKSPACE/source-repo/"* .

# Add all changes
git add -A

# Create commit with tag reference
echo "Committing changes..."
git commit -m "Sync with $SOURCE_REPO tag: $TAG" || {
    echo "No changes to commit"
    exit 0
}

# Push new branch to remote
echo "Pushing new branch to destination repository..."
git push -u origin "$NEW_BRANCH"

echo "Sync completed successfully!"
echo "New branch created: $NEW_BRANCH"

# Cleanup
echo "Cleaning up workspace..."
rm -rf "$WORKSPACE"

# Print URL for creating pull request (if applicable)
DEST_REPO_URL=$(echo "$DEST_REPO" | sed 's/\.git$//' | sed 's/:/@/g' | sed 's/git@/https:\/\//g')
echo
echo "To create a pull request, visit:"
echo "$DEST_REPO_URL/compare/main...$NEW_BRANCH"
