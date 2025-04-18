function doRandomPlaceBlock() {
  if (isPlacingBlock) {
    console.log("Already placing a block, skipping");
    return;
  }

  isPlacingBlock = true;
  console.log("Bot attempting to place a block");

  try {
    // Expanded list of block types to search for in inventory
    const blockItem = bot.inventory
      .items()
      .find((item) =>
        ["planks", "stone", "cobble", "dirt", "netherrack"].some((name) =>
          item.name.includes(name)
        )
      );

    if (!blockItem) {
      console.log("No suitable blocks in inventory");
      isPlacingBlock = false;
      return;
    }

    // Look for places to put blocks more extensively
    const possibleDirections = [
      new Vec3(1, 0, 0),
      new Vec3(-1, 0, 0),
      new Vec3(0, 0, 1),
      new Vec3(0, 0, -1),
      new Vec3(1, 0, 1),
      new Vec3(-1, 0, 1),
      new Vec3(1, 0, -1),
      new Vec3(-1, 0, -1),
    ];

    // Try different positions around the bot
    const botPos = bot.entity.position.floored();
    let placedBlock = false;

    // Function to try placing at a specific position
    const tryPlaceAtPosition = async (position, dir) => {
      if (placedBlock) return true;

      const referenceBlock = bot.blockAt(position);

      // Check if we can see the block and that the space above is air
      if (
        referenceBlock &&
        bot.canSeeBlock(referenceBlock) &&
        bot.blockAt(position.offset(0, 1, 0))?.name === "air"
      ) {
        // Check if placement is within allowed area
        const placePos = position.offset(0, 1, 0);
        if (
          placePos.x >= MIN_CORNER.x &&
          placePos.x <= MAX_CORNER.x &&
          placePos.y >= MIN_CORNER.y &&
          placePos.y <= MAX_CORNER.y &&
          placePos.z >= MIN_CORNER.z &&
          placePos.z <= MAX_CORNER.z
        ) {
          try {
            // Equip the block
            await new Promise((resolve, reject) => {
              bot.equip(blockItem, "hand", (err) => {
                if (err) {
                  console.log("Failed to equip block:", err.message);
                  reject(err);
                } else {
                  resolve();
                }
              });
            });

            // Look at the block first
            const yaw = Math.atan2(-dir.z, dir.x);
            await bot.look(yaw, 0, false);

            // Add a small delay to simulate human behavior
            await new Promise((resolve) => setTimeout(resolve, 200));

            // Try to place the block with a timeout
            await Promise.race([
              bot.placeBlock(referenceBlock, new Vec3(0, 1, 0)),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Place timeout")), 2000)
              ),
            ]);

            console.log(`Successfully placed ${blockItem.name}`);
            placedBlock = true;
            return true;
          } catch (placeErr) {
            console.log("Failed to place block:", placeErr.message);
          }
        }
      }
      return false;
    };

    // Try all directions and positions
    (async () => {
      for (const dir of possibleDirections) {
        if (placedBlock) break;

        // Try on same level and one below
        for (const yOffset of [0, -1]) {
          if (placedBlock) break;

          const position = botPos.offset(dir.x, yOffset, dir.z);
          await tryPlaceAtPosition(position, dir);
        }
      }
      isPlacingBlock = false;
    })();
  } catch (err) {
    console.log(`Block placement function error: ${err.message}`);
    isPlacingBlock = false;
  }
}

function doRandomMineBlock() {
  // Check if already mining
  if (isMining) {
    console.log("Already mining, skipping");
    return;
  }

  isMining = true;
  console.log("Bot attempting to mine a block");

  (async () => {
    try {
      // Safety check for bot entity
      if (!bot || !bot.entity || !bot.entity.position) {
        console.log("Bot entity not available");
        isMining = false;
        return;
      }

      let targetBlocks = [];

      try {
        // Find target blocks within the allowed area
        targetBlocks = bot.findBlocks({
          matching: (block) => {
            if (!block || !block.position || !block.name) return false;

            // Fix for the null bedLocation error
            const isBed = bedLocation
              ? block.position.equals(bedLocation) ||
                (block.position &&
                  bedLocation &&
                  bedLocation.offset &&
                  block.position.equals(bedLocation.offset(0, 1, 0)))
              : false;

            return (
              ALLOWED_BLOCKS.includes(block.name) &&
              !isBed &&
              block.position.x >= MIN_CORNER.x &&
              block.position.y >= MIN_CORNER.y &&
              block.position.z >= MIN_CORNER.z &&
              block.position.x <= MAX_CORNER.x &&
              block.position.y <= MAX_CORNER.y &&
              block.position.z <= MAX_CORNER.z
            );
          },
          maxDistance: 32,
          count: 10,
        });
      } catch (findErr) {
        console.log(`Error finding blocks: ${findErr.message}`);
        isMining = false;
        return;
      }

      if (!targetBlocks || targetBlocks.length === 0) {
        console.log("No suitable blocks found to mine");
        isMining = false;
        return;
      }

      // Select a random block from those found
      const targetPos =
        targetBlocks[Math.floor(Math.random() * targetBlocks.length)];
      if (!targetPos) {
        console.log("No valid target position");
        isMining = false;
        return;
      }

      const targetBlock = bot.blockAt(targetPos);
      if (
        !targetBlock ||
        !targetBlock.name ||
        !ALLOWED_BLOCKS.includes(targetBlock.name)
      ) {
        console.log("Target block disappeared or is not allowed");
        isMining = false;
        return;
      }

      console.log(`Attempting to mine ${targetBlock.name} at ${targetPos}`);

      // Check if we're close enough to mine without moving
      if (bot.entity.position.distanceTo(targetPos) <= 4) {
        console.log("Already close enough to mine");

        try {
          // Look at the block before mining
          if (targetPos) {
            const blockDir = targetPos.minus(bot.entity.position).normalize();
            const yaw = Math.atan2(-blockDir.z, blockDir.x);
            const pitch = Math.asin(-blockDir.y);

            await bot.look(yaw, pitch, true);
          }

          // Add a short human-like delay before starting to mine
          await new Promise((resolve) => setTimeout(resolve, 500));

          // Try to dig with a timeout
          await Promise.race([
            bot.dig(targetBlock),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Dig timeout")), 10000)
            ),
          ]);

          console.log(`Successfully mined ${targetBlock.name}`);
          isMining = false;
          return;
        } catch (digErr) {
          console.log(`Direct mining error: ${digErr.message}`);
          isMining = false;
          return;
        }
      }

      // Move close to the block first
      try {
        const defaultMovements = new Movements(bot, bot.registry);
        bot.pathfinder.setMovements(defaultMovements);

        try {
          bot.pathfinder.setGoal(
            new GoalNear(targetPos.x, targetPos.y, targetPos.z, 3)
          );
        } catch (pathErr) {
          console.log(`Pathfinding error: ${pathErr.message}`);
          isMining = false;
          return;
        }

        // Wait for bot to get close enough
        const checkInterval = setInterval(async () => {
          if (!bot || !bot.entity || !bot.entity.position) {
            clearInterval(checkInterval);
            console.log("Bot no longer available");
            isMining = false;
            return;
          }

          if (bot.entity.position.distanceTo(targetPos) <= 4) {
            clearInterval(checkInterval);

            try {
              // Look at the block before mining
              if (targetPos) {
                const blockDir = targetPos
                  .minus(bot.entity.position)
                  .normalize();
                const yaw = Math.atan2(-blockDir.z, blockDir.x);
                const pitch = Math.asin(-blockDir.y);

                await bot.look(yaw, pitch, true);
              }

              // Add a short human-like delay before starting to mine
              await new Promise((resolve) => setTimeout(resolve, 500));

              // Check if block still exists
              const currentBlock = bot.blockAt(targetPos);
              if (
                !currentBlock ||
                !ALLOWED_BLOCKS.includes(currentBlock.name)
              ) {
                console.log("Target block no longer exists");
                isMining = false;
                return;
              }

              // Try to dig with a timeout
              await Promise.race([
                bot.dig(currentBlock),
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error("Dig timeout")), 10000)
                ),
              ]);

              console.log(`Successfully mined ${currentBlock.name}`);
            } catch (err) {
              console.log(`Mining action error: ${err.message}`);
            } finally {
              isMining = false;
            }
          }
        }, 1000);

        // Set a timeout in case pathfinding takes too long
        setTimeout(() => {
          clearInterval(checkInterval);
          console.log("Mining attempt timed out - could not reach target");
          isMining = false;
        }, 15000);
      } catch (err) {
        console.log(`Mining approach error: ${err.message}`);
        isMining = false;
      }
    } catch (err) {
      console.log(`Mining function error: ${err.message}`);
      isMining = false;
    }
  })();
}
